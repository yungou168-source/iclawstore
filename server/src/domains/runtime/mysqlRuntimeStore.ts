import { randomUUID } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
type RuntimeRow = RowDataPacket & Record<string, unknown>;
import { decideLeaseAcquire, decideLeaseRelease, decideLeaseRenew, type Lease } from './runtimeFoundation.js';

const rowLease = (row: Record<string, unknown> | undefined): Lease | null => row ? { ownerId: row.ownerId as string, token: row.token as string, expiresAt: new Date(row.expiresAt as string) } : null;

export const createMysqlRuntimeStore = (pool: Pool) => ({
  async acquire(workerName: string, ownerId: string, durationMs: number): Promise<Lease | null> {
    const token = randomUUID(); const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<RuntimeRow[]>('SELECT ownerId, token, expiresAt FROM migration_worker_leases WHERE workerName = ? FOR UPDATE', [workerName]);
      const decision = decideLeaseAcquire({ current: rowLease(rows[0]), ownerId, token, now: new Date(), durationMs });
      if (decision.kind === 'unavailable') { await connection.rollback(); return null; }
      await connection.query('INSERT INTO migration_worker_leases (workerName, ownerId, token, expiresAt) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE ownerId=VALUES(ownerId), token=VALUES(token), expiresAt=VALUES(expiresAt)', [workerName, ownerId, decision.lease.token, decision.lease.expiresAt]);
      await connection.commit(); return decision.lease;
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  },
  async renew(workerName: string, lease: Lease, durationMs: number): Promise<Lease | null> {
    const [rows] = await pool.query<RuntimeRow[]>('SELECT ownerId, token, expiresAt FROM migration_worker_leases WHERE workerName = ?', [workerName]);
    const decision = decideLeaseRenew({ current: rowLease(rows[0]), ownerId: lease.ownerId, token: lease.token, now: new Date(), durationMs });
    if (decision.kind !== 'renewed') return null;
    await pool.query('UPDATE migration_worker_leases SET expiresAt = ? WHERE workerName = ? AND ownerId = ? AND token = ?', [decision.lease.expiresAt, workerName, lease.ownerId, lease.token]);
    return decision.lease;
  },
  async release(workerName: string, lease: Lease): Promise<boolean> {
    const [result] = await pool.query('DELETE FROM migration_worker_leases WHERE workerName = ? AND ownerId = ? AND token = ?', [workerName, lease.ownerId, lease.token]);
    return (result as { affectedRows: number }).affectedRows === 1;
  },
  async checkpoint(workerName: string, cursor: string | null, watermark: string, completed: boolean): Promise<void> {
    await pool.query('INSERT INTO migration_checkpoints (workerName, cursorValue, watermark, completed) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE cursorValue=VALUES(cursorValue), watermark=VALUES(watermark), completed=VALUES(completed)', [workerName, cursor, watermark, completed]);
  },
});