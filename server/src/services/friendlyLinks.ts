import { randomUUID } from "node:crypto";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export type FriendlyLink = {
  id: string;
  label: string;
  url: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type FriendlyLinkRow = RowDataPacket & {
  id: string;
  label: string;
  url: string;
  description: string | null;
  sortOrder: number;
  isActive: number | boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type FriendlyLinkInput = {
  label: string;
  url: string;
  description?: string | null;
  sortOrder: number;
  isActive: boolean;
};

const fromRow = (row: FriendlyLinkRow): FriendlyLink => ({
  id: row.id,
  label: row.label,
  url: row.url,
  description: row.description,
  sortOrder: row.sortOrder,
  isActive: Boolean(row.isActive),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const columns = "id, label, url, description, sortOrder, isActive, createdAt, updatedAt";

export async function listPublicFriendlyLinks(pool: Pool): Promise<FriendlyLink[]> {
  const [rows] = await pool.query<FriendlyLinkRow[]>(
    `SELECT ${columns}
     FROM friendly_links
     WHERE isActive = TRUE
     ORDER BY sortOrder ASC, id ASC
     LIMIT 100`,
  );
  return rows.map(fromRow);
}

export async function listFriendlyLinksForAdmin(pool: Pool): Promise<FriendlyLink[]> {
  const [rows] = await pool.query<FriendlyLinkRow[]>(
    `SELECT ${columns}
     FROM friendly_links
     ORDER BY sortOrder ASC, id ASC
     LIMIT 500`,
  );
  return rows.map(fromRow);
}

export async function createFriendlyLink(
  pool: Pool,
  input: FriendlyLinkInput,
  actorUserId: string,
): Promise<FriendlyLink> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO friendly_links
       (id, label, url, description, sortOrder, isActive, createdByUserId, updatedByUserId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.label,
      input.url,
      input.description ?? null,
      input.sortOrder,
      input.isActive,
      actorUserId,
      actorUserId,
    ],
  );
  return getFriendlyLink(pool, id);
}

export async function updateFriendlyLink(
  pool: Pool,
  id: string,
  input: FriendlyLinkInput,
  actorUserId: string,
): Promise<FriendlyLink> {
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE friendly_links
     SET label = ?, url = ?, description = ?, sortOrder = ?, isActive = ?, updatedByUserId = ?
     WHERE id = ?`,
    [
      input.label,
      input.url,
      input.description ?? null,
      input.sortOrder,
      input.isActive,
      actorUserId,
      id,
    ],
  );
  if (result.affectedRows === 0) throw new FriendlyLinkNotFoundError();
  return getFriendlyLink(pool, id);
}

export async function deleteFriendlyLink(pool: Pool, id: string): Promise<void> {
  const [result] = await pool.query<ResultSetHeader>("DELETE FROM friendly_links WHERE id = ?", [
    id,
  ]);
  if (result.affectedRows === 0) throw new FriendlyLinkNotFoundError();
}

async function getFriendlyLink(pool: Pool, id: string): Promise<FriendlyLink> {
  const [rows] = await pool.query<FriendlyLinkRow[]>(
    `SELECT ${columns} FROM friendly_links WHERE id = ? LIMIT 1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new FriendlyLinkNotFoundError();
  return fromRow(row);
}

export class FriendlyLinkNotFoundError extends Error {
  constructor() {
    super("友情链接不存在");
    this.name = "FriendlyLinkNotFoundError";
  }
}
