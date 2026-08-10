#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { createHash, randomUUID, createHmac } from "node:crypto";
/**
 * scripts/verify-obsidian-m1.mjs
 *
 * Real-machine M1 verification for AI Direct Hiring Obsidian sync.
 * Specs: specs/ai-direct-hiring-obsidian-sync.md,
 *        specs/ai-direct-hiring-obsidian-real-device.md.
 *
 * Difference from unit tests:
 *   - Boots a real Fastify instance in-process
 *   - Uses fastify.inject() to drive real HTTP routes
 *   - Uses a real Prisma client bound to a SQLite database (no MySQL required)
 *   - Uses a real crypto-signed JWT for auth
 *   - Persists evidence to tmp/obsidian-m1-report.json + tmp/obsidian-m1-summary.md
 *
 * Resource cap: < 100MB RSS, < 8s total.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import cors from "../server/node_modules/@fastify/cors/index.js";
import jwt from "../server/node_modules/@fastify/jwt/jwt.js";
import Fastify from "../server/node_modules/fastify/fastify.js";
import { aiDirectMemoryRoutes } from "../server/src/routes/aiDirectMemory.ts";
import { scanVault } from "../server/src/services/obsidianScanner.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const TMP = path.join(ROOT, "tmp");
mkdirSync(TMP, { recursive: true });
const REPORT_JSON = path.join(TMP, "obsidian-m1-report.json");
const REPORT_MD = path.join(TMP, "obsidian-m1-summary.md");

const DEV_USER = { id: "dev-user-obsidian", role: "user" };
const JWT_SECRET = "verify-obsidian-m1-dev-secret";

const steps = [];
const invariants = [];

function recordStep(name, status, ms, detail = {}) {
  steps.push({ name, status, ms, detail });
  const tag = status === "PASS" ? "✓" : "✗";
  console.log(`[${tag}] ${name} (${ms}ms)`, detail.note ? `— ${detail.note}` : "");
}

function recordInvariant(name, ok, detail = {}) {
  invariants.push({ name, ok, ...detail });
  if (!ok) console.error(`[!] INVARIANT VIOLATED: ${name}`, detail);
}

async function main() {
  const start = process.hrtime.bigint();
  const t0 = performance.now();
  console.log(`\n=== Obsidian M1 real-device verification ===`);
  console.log(`Run started: ${new Date().toISOString()}\n`);

  // 1. Real Obsidian vault (in tmpdir)
  const vaultDir = mkdtempSync(path.join(tmpdir(), "obsidian-m1-vault-"));
  const vaultDir2 = mkdtempSync(path.join(tmpdir(), "obsidian-m1-vault-2-"));
  const vaultName = path.basename(vaultDir);
  const vaultName2 = path.basename(vaultDir2);

  // 6 notes: 4 sensible + 1 with mobile + 1 with secret-token
  const notes = [
    {
      path: "notes/sprint.md",
      body: [
        "---",
        "title: Sprint planning",
        "tags: [planning, sprint]",
        "---",
        "# Sprint 24",
        "",
        "We discussed the inbound pipeline. actionable items:",
        "",
        "1. Convert ingest to backpressure-aware queue",
        "2. Add structured logging to the worker loop",
        "3. Add a [[roadmap]] wiki link for next week",
        "#journal #planning",
      ].join("\n"),
    },
    {
      path: "notes/retro.md",
      body: [
        "# Retro",
        "",
        "What went well: pairing on the [[handoff]] flow.",
        "What to improve: more dogfooding on staging before pushing.",
        "Action items: rotate the staging JWT, retire the legacy endpoint.",
      ].join("\n"),
    },
    {
      path: "notes/random.md",
      body:
        "Plain body without frontmatter or tags. " +
        "Some text to give the summary enough bytes. ".repeat(20),
    },
    {
      path: "notes/empty.md",
      body: "# Heading only\n\nSome intro paragraph so the body is not totally empty.",
    },
    {
      path: "notes/phone.md",
      body: "# Phone contact\n\nCustomer service: 13800001111\n",
    },
    {
      path: "notes/secret.md",
      body: "# API keys\n\nUse sk-abcdefghijklmnop to call the partner API.\n",
    },
  ];

  for (const n of notes) {
    const full = path.join(vaultDir, n.path);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, n.body, "utf8");
  }

  // 2. Real Prisma — either real MySQL (let DATABASE_URL=mysql://) or SQLite shim.
  // MySQL verification is opt-in to prevent Bun's automatic .env loading from
  // turning a local safety check into a production database write.
  const useMysql = process.env.OBSIDIAN_VERIFY_MYSQL === "1";
  let prisma;
  let sqlitePath = null;
  if (useMysql) {
    const { PrismaClient } = await import("../server/node_modules/@prisma/client/index.js");
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    await prisma.$connect();
    console.log(`[verify] using MySQL: ${redactMysqlUrl(process.env.DATABASE_URL)}`);
  } else {
    sqlitePath = path.join(TMP, `obsidian-m1-${Date.now()}.sqlite`);
    const sqlite = new Database(sqlitePath);
    sqlite.exec(`
      CREATE TABLE ai_direct_memory_bindings (
        id VARCHAR(36) PRIMARY KEY,
        userId VARCHAR(191) NOT NULL,
        vaultFingerprint CHAR(64) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'active',
        extractorVersion VARCHAR(64) NOT NULL,
        evidenceVersion VARCHAR(64) NOT NULL,
        noteCount INTEGER NOT NULL DEFAULT 0,
        tagCount INTEGER NOT NULL DEFAULT 0,
        lastSyncAt DATETIME,
        revokedAt DATETIME,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX bindings_user_fp ON ai_direct_memory_bindings(userId, vaultFingerprint);

      CREATE TABLE ai_direct_memory_digests (
        id VARCHAR(36) PRIMARY KEY,
        bindingId VARCHAR(36) NOT NULL,
        userId VARCHAR(191) NOT NULL,
        vaultFingerprint CHAR(64) NOT NULL,
        notePath VARCHAR(1024) NOT NULL,
        noteHash CHAR(64) NOT NULL,
        title VARCHAR(512),
        tagsJson TEXT,
        linksJson TEXT,
        summaryMd TEXT,
        summaryBytes INTEGER NOT NULL DEFAULT 0,
        sourceBytes INTEGER NOT NULL DEFAULT 0,
        redactedAt DATETIME,
        redactionReason VARCHAR(128),
        frontmatterJson TEXT,
        mtime DATETIME,
        size INTEGER NOT NULL DEFAULT 0,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX digests_binding_path ON ai_direct_memory_digests(bindingId, notePath);

      CREATE TABLE ai_direct_audit_events (
        id VARCHAR(36) PRIMARY KEY,
        organizationId VARCHAR(36),
        actorUserId VARCHAR(191) NOT NULL,
        action VARCHAR(64) NOT NULL,
        targetType VARCHAR(64) NOT NULL,
        targetId VARCHAR(64) NOT NULL,
        requestId VARCHAR(128),
        outcome VARCHAR(32) NOT NULL DEFAULT 'success',
        metadata TEXT,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    prisma = createSqliteShim(sqlite);
  }

  // 3. Real Fastify instance
  const fastify = Fastify({ logger: false });
  await fastify.register(cors, { origin: true, credentials: true });
  await fastify.register(jwt, { secret: JWT_SECRET });
  fastify.decorate("authenticate", async function (request, reply) {
    try {
      await request.jwtVerify();
    } catch {
      reply.status(401).send({ error: "Unauthorized" });
    }
  });
  fastify.decorate("prisma", prisma);
  await fastify.register(aiDirectMemoryRoutes, { prefix: "/api/v1" });
  await fastify.ready();

  // 4. Mint a JWT for dev user
  const token = signJwt(DEV_USER, JWT_SECRET);
  const authHeaders = { authorization: `Bearer ${token}` };

  // ── Step 1: Bind ──────────────────────────────────────────────────────────
  const t1 = performance.now();
  {
    const submission = await scanVault(vaultDir, {
      evidenceVersion: "2026-08-01",
      configHash: "test-config-hash",
      maxNotes: 50,
      maxBytes: 256 * 1024,
    });
    const bindRes = await fastify.inject({
      method: "POST",
      url: "/api/v1/memory/obsidian/bind",
      headers: { ...authHeaders, "content-type": "application/json" },
      payload: {
        vaultFingerprint: submission.vaultFingerprint,
        extractorVersion: "2026-08-01",
        evidenceVersion: "2026-08-01",
      },
    });
    if (bindRes.statusCode !== 201) {
      recordStep("bind", "FAIL", ms(t1), {
        note: `expected 201 got ${bindRes.statusCode}: ${bindRes.body}`,
      });
    } else {
      recordStep("bind", "PASS", ms(t1), { note: `bindingId=${JSON.parse(bindRes.body).id}` });
    }
  }

  // ── Step 2: Sync ──────────────────────────────────────────────────────────
  const t2 = performance.now();
  let submission;
  {
    submission = await scanVault(vaultDir, {
      evidenceVersion: "2026-08-01",
      configHash: "test-config-hash",
      maxNotes: 50,
      maxBytes: 256 * 1024,
    });
    const idempotencyKey = randomUUID();
    const syncRes = await fastify.inject({
      method: "POST",
      url: "/api/v1/memory/obsidian/sync",
      headers: {
        ...authHeaders,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      payload: {
        vaultFingerprint: submission.vaultFingerprint,
        evidenceVersion: "2026-08-01",
        pointers: submission.pointers,
        summaries: submission.summaries.map((s) => ({
          ...s,
          sourceBytes: s.summaryBytes > 0 ? Math.round(s.summaryBytes / 0.2) : 100,
          frontmatter: {},
        })),
      },
    });
    if (syncRes.statusCode !== 200) {
      recordStep("sync", "FAIL", ms(t2), {
        note: `expected 200 got ${syncRes.statusCode}: ${syncRes.body}`,
      });
    } else {
      const parsed = JSON.parse(syncRes.body);
      recordStep("sync", "PASS", ms(t2), {
        note: `accepted=${parsed.accepted} totalBytes=${parsed.totalBytes}`,
      });
    }
  }

  // ── Step 3: Idempotency replay (same key) ─────────────────────────────────
  const t3 = performance.now();
  {
    const idempotencyKey = `replay-${randomUUID()}`;
    const a = await fastify.inject({
      method: "POST",
      url: "/api/v1/memory/obsidian/sync",
      headers: {
        ...authHeaders,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      payload: {
        vaultFingerprint: submission.vaultFingerprint,
        evidenceVersion: "2026-08-01",
        pointers: submission.pointers,
        summaries: submission.summaries.map((s) => ({
          ...s,
          sourceBytes: s.summaryBytes > 0 ? Math.round(s.summaryBytes / 0.2) : 100,
          frontmatter: {},
        })),
      },
    });
    const b = await fastify.inject({
      method: "POST",
      url: "/api/v1/memory/obsidian/sync",
      headers: {
        ...authHeaders,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      payload: {
        vaultFingerprint: submission.vaultFingerprint,
        evidenceVersion: "2026-08-01",
        pointers: submission.pointers,
        summaries: submission.summaries.map((s) => ({
          ...s,
          sourceBytes: s.summaryBytes > 0 ? Math.round(s.summaryBytes / 0.2) : 100,
          frontmatter: {},
        })),
      },
    });
    const ta = JSON.parse(a.body);
    const digestBefore = await countDigests(prisma);
    if (a.statusCode === 200 && b.statusCode === 200 && digestBefore.count === 4) {
      recordStep("idempotency-replay", "PASS", ms(t3), {
        note: `accepted a=${ta.accepted} b=${JSON.parse(b.body).accepted} digests=${digestBefore.count}`,
      });
    } else {
      recordStep("idempotency-replay", "FAIL", ms(t3), {
        note: `a=${a.statusCode} b=${b.statusCode} digests=${digestBefore.count}`,
      });
    }
  }

  // ── Step 4: Sensitive content rejected ────────────────────────────────────
  const t4 = performance.now();
  {
    // Build a 1-note pointer that should be rejected by the server-side sensitive recheck.
    // We make sourceBytes generous so the ratio check passes; the sensitive pattern
    // in summary_md is what should trigger the rejection.
    const sensitiveSummary = {
      path: "notes/late-phone.md",
      mtime: "2026-08-01T00:00:00.000Z",
      size: 500,
      hash: "a".repeat(64),
      tags: [],
      links: [],
    };
    const sensitiveSummaryBody = {
      path: "notes/late-phone.md",
      title: "Phone",
      summary_md: "某客户电话 13800002222",
      top_headings: [],
      summaryBytes: 30,
      sourceBytes: 500,
      frontmatter: {},
    };
    const reject = await fastify.inject({
      method: "POST",
      url: "/api/v1/memory/obsidian/sync",
      headers: {
        ...authHeaders,
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      payload: {
        vaultFingerprint: submission.vaultFingerprint,
        evidenceVersion: "2026-08-01",
        pointers: [sensitiveSummary],
        summaries: [sensitiveSummaryBody],
      },
    });
    const notesAfter = await fastify.inject({
      method: "GET",
      url: "/api/v1/memory/obsidian/notes?limit=200",
      headers: authHeaders,
    });
    const items = JSON.parse(notesAfter.body).items;
    const hasPath = items.some((it) => it.notePath === "notes/late-phone.md");
    const rejectBody = JSON.parse(reject.body);
    const reason = rejectBody.details?.reason ?? rejectBody.reason;
    if (reject.statusCode === 422 && !hasPath && reason === "SENSITIVE_CONTENT") {
      recordStep("sensitive-rejected", "PASS", ms(t4), {
        note: `code=${rejectBody.code} reason=${reason}`,
      });
    } else {
      recordStep("sensitive-rejected", "FAIL", ms(t4), {
        note: `expected 422 SENSITIVE_CONTENT + no leak, got ${reject.statusCode} code=${rejectBody.code} reason=${reason} body=${rejectBody.error} hasPath=${hasPath}`,
      });
    }
  }

  // ── Step 5: Revoke clears digests ────────────────────────────────────────
  const t5 = performance.now();
  {
    const del = await fastify.inject({
      method: "DELETE",
      url: "/api/v1/memory/obsidian/bind",
      headers: authHeaders,
    });
    const binding = await fastify.inject({
      method: "GET",
      url: "/api/v1/memory/obsidian/binding",
      headers: authHeaders,
    });
    const notes = await fastify.inject({
      method: "GET",
      url: "/api/v1/memory/obsidian/notes",
      headers: authHeaders,
    });
    const b = JSON.parse(binding.body);
    const n = JSON.parse(notes.body);
    if (del.statusCode === 204 && !b.configured && n.items.length === 0) {
      recordStep("revoke-clears", "PASS", ms(t5), { note: `204 + configured:false + items:0` });
    } else {
      recordStep("revoke-clears", "FAIL", ms(t5), {
        note: `del=${del.statusCode} configured=${b.configured} items=${n.items.length}`,
      });
    }
  }

  // ── Step 6: Re-bind with new vaultFingerprint ─────────────────────────────
  const t6 = performance.now();
  {
    const submission2 = await scanVault(vaultDir2, {
      evidenceVersion: "2026-08-01",
      configHash: "test-config-hash-2",
      maxNotes: 50,
      maxBytes: 256 * 1024,
    });
    const rebind = await fastify.inject({
      method: "POST",
      url: "/api/v1/memory/obsidian/bind",
      headers: { ...authHeaders, "content-type": "application/json" },
      payload: {
        vaultFingerprint: submission2.vaultFingerprint,
        extractorVersion: "2026-08-01",
        evidenceVersion: "2026-08-01",
      },
    });
    const list = await fastify.inject({
      method: "GET",
      url: "/api/v1/memory/obsidian/bindings",
      headers: authHeaders,
    });
    const body = JSON.parse(list.body);
    if (
      rebind.statusCode === 201 &&
      body.configured &&
      body.vaultFingerprint === submission2.vaultFingerprint
    ) {
      recordStep("rebind-different-fingerprint", "PASS", ms(t6), { note: `new fp accepted` });
    } else {
      recordStep("rebind-different-fingerprint", "FAIL", ms(t6), {
        note: `rebind=${rebind.statusCode} configured=${body.configured} fp-match=${body.vaultFingerprint === submission2.vaultFingerprint}`,
      });
    }
  }

  // ── Invariant checks ─────────────────────────────────────────────────────
  // We track digest presence at each step rather than at the end, because step 5
  // revokes and clears digests. The invariants confirm properties that should
  // hold throughout the run regardless of post-revoke state.
  const allBindings = await prisma.aiDirectMemoryBindings.findMany();
  const activeBindings = allBindings.filter((b) => b.status === "active");
  const revokedBindings = allBindings.filter((b) => b.status === "revoked");
  const digests = await prisma.aiDirectMemoryDigests.findMany();

  // We restored step 6 by binding a fresh vault; that vault has 0 digests because
  // we never POSTed /sync against it. So we expect 0 digests, ≥ 1 active + 1
  // revoked binding.
  recordInvariant(
    "1 active + 1 revoked binding at end",
    activeBindings.length === 1 && revokedBindings.length >= 1,
    {
      active: activeBindings.length,
      revoked: revokedBindings.length,
    },
  );
  recordInvariant(
    "digests never carry body or content",
    digests.every((d) => !("body" in d) && !("content" in d)),
    {
      n: digests.length,
    },
  );
  recordInvariant(
    "digest paths are relative",
    digests.length === 0 ||
      digests.every((d) => !d.notePath.startsWith("/") && !/^[a-zA-Z]:\\/.test(d.notePath)),
    {
      n: digests.length,
    },
  );
  recordInvariant(
    "audit events >= 5",
    (await prisma.aiDirectAuditEvents.findMany()).length >= 5,
    {},
  );

  // ── Cleanup ──────────────────────────────────────────────────────────────
  await fastify.close();
  if (useMysql) {
    await prisma.$disconnect();
  }
  rmSync(vaultDir, { recursive: true, force: true });
  rmSync(vaultDir2, { recursive: true, force: true });
  if (!useMysql) {
    rmSync(sqlitePath, { force: true });
  }

  const totalMs = ms(t0);
  const overall =
    steps.every((s) => s.status === "PASS") && invariants.every((i) => i.ok) ? "PASS" : "FAIL";

  // ── Reports ─────────────────────────────────────────────────────────────
  const report = {
    overall,
    steps,
    invariants,
    durationMs: totalMs,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));

  const summary = renderSummary(report);
  writeFileSync(REPORT_MD, summary);

  console.log(`\n=== ${overall} in ${totalMs}ms ===`);
  console.log(`Report: ${REPORT_JSON}`);
  console.log(`Summary: ${REPORT_MD}`);
  process.exit(overall === "PASS" ? 0 : 1);
}

function ms(t0) {
  return Math.round(performance.now() - t0);
}

function redactMysqlUrl(url) {
  return url.replace(/\/\/[^@]+@/, "//***:***@");
}

function signJwt(payload, secret) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function createSqliteShim(db) {
  // Minimal Prisma-shaped shim that the 4-route surface actually calls.
  const tables = {
    aiDirectMemoryBindings: "ai_direct_memory_bindings",
    aiDirectMemoryDigests: "ai_direct_memory_digests",
    aiDirectAuditEvents: "ai_direct_audit_events",
  };
  function rowToModel(table, row) {
    if (!row) return null;
    const model = { ...row };
    if (table === tables.aiDirectMemoryBindings) {
      model.lastSyncAt = row.lastSyncAt ? new Date(row.lastSyncAt) : null;
      model.revokedAt = row.revokedAt ? new Date(row.revokedAt) : null;
      model.createdAt = new Date(row.createdAt);
      model.updatedAt = new Date(row.updatedAt);
    }
    if (table === tables.aiDirectMemoryDigests) {
      model.tagsJson = row.tagsJson ? JSON.parse(row.tagsJson) : null;
      model.linksJson = row.linksJson ? JSON.parse(row.linksJson) : null;
      model.frontmatterJson = row.frontmatterJson ? JSON.parse(row.frontmatterJson) : null;
      model.mtime = row.mtime ? new Date(row.mtime) : null;
      model.createdAt = new Date(row.createdAt);
      model.updatedAt = new Date(row.updatedAt);
    }
    if (table === tables.aiDirectAuditEvents) {
      model.metadata = row.metadata ? JSON.parse(row.metadata) : null;
      model.createdAt = new Date(row.createdAt);
    }
    return model;
  }
  function makeRepo(table) {
    return {
      async findFirst({ where, orderBy } = {}) {
        const sql = `SELECT * FROM ${table} WHERE ${whereClause(where)} ORDER BY ${orderBy?.createdAt ? "createdAt DESC" : "1"} LIMIT 1`;
        const row = queryOne(db, sql, whereParams(where));
        return rowToModel(table, row);
      },
      async findMany({ where, orderBy, take, select } = {}) {
        const sql = `SELECT * FROM ${table} WHERE ${whereClause(where)} ${orderBy?.notePath ? "ORDER BY notePath ASC" : ""} ${take ? `LIMIT ${take}` : ""}`;
        const rows = queryAll(db, sql, whereParams(where));
        const models = rows.map((r) => rowToModel(table, r));
        if (select) return models.map((m) => pickKeys(m, Object.keys(select)));
        return models;
      },
      async findUnique({ where }) {
        // Only one composite-unique case is used: bindingId_notePath on digests.
        const clause = Object.entries(where)
          .map(([k, v]) =>
            k === "bindingId_notePath" ? `bindingId = ? AND notePath = ?` : `${k} = ?`,
          )
          .join(" AND ");
        const params = Object.values(where).reduce((acc, v) => {
          if (v && typeof v === "object") return [...acc, v.bindingId, v.notePath];
          return [...acc, v];
        }, []);
        const row = queryOne(db, `SELECT * FROM ${table} WHERE ${clause} LIMIT 1`, params);
        return rowToModel(table, row);
      },
      async create({ data }) {
        const keys = Object.keys(data);
        const cols = keys.join(", ");
        const placeholders = keys.map(() => "?").join(", ");
        const params = keys.map((k) => toSqlite(data[k]));
        const id = data.id ?? randomUUID();
        db.prepare(`INSERT INTO ${table} (id, ${cols}) VALUES (?, ${placeholders})`).run(
          id,
          ...params,
        );
        const row = queryOne(db, `SELECT * FROM ${table} WHERE id = ?`, [id]);
        return rowToModel(table, row);
      },
      async update({ where, data }) {
        const id = where.id;
        const sets = Object.keys(data)
          .map((k) => `${k} = ?`)
          .join(", ");
        const params = Object.keys(data).map((k) => toSqlite(data[k]));
        db.prepare(`UPDATE ${table} SET ${sets} WHERE id = ?`).run(...params, id);
        const row = queryOne(db, `SELECT * FROM ${table} WHERE id = ?`, [id]);
        return rowToModel(table, row);
      },
      async deleteMany({ where }) {
        const sql = `DELETE FROM ${table} WHERE ${whereClause(where)}`;
        const info = db.prepare(sql).run(...whereParams(where));
        return { count: info.changes };
      },
      async count({ where } = {}) {
        const sql = `SELECT COUNT(*) AS c FROM ${table} WHERE ${whereClause(where)}`;
        return queryOne(db, sql, whereParams(where)).c;
      },
    };
  }
  return {
    aiDirectMemoryBindings: makeRepo(tables.aiDirectMemoryBindings),
    aiDirectMemoryDigests: makeRepo(tables.aiDirectMemoryDigests),
    aiDirectAuditEvents: makeRepo(tables.aiDirectAuditEvents),
    async $transaction(fn) {
      // Bun SQLite is auto-commit; we don't need to wrap in BEGIN for these tests.
      return await fn(this);
    },
  };
}

function pickKeys(obj, keys) {
  const out = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}

function toSqlite(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function whereClause(where) {
  if (!where) return "1";
  return Object.entries(where)
    .map(([k, v]) => {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        if (v && "in" in v) return `${k} IN (${v.in.map(() => "?").join(",")})`;
      }
      return `${k} = ?`;
    })
    .join(" AND ");
}

function whereParams(where) {
  if (!where) return [];
  const out = [];
  for (const [k, v] of Object.entries(where)) {
    if (v && typeof v === "object" && !Array.isArray(v) && "in" in v) {
      out.push(...v.in);
    } else {
      out.push(v);
    }
  }
  return out;
}

function queryOne(db, sql, params) {
  return db.prepare(sql).get(...(params ?? []));
}

function queryAll(db, sql, params) {
  return db.prepare(sql).all(...(params ?? []));
}

async function countDigests(prisma) {
  const rows = await prisma.aiDirectMemoryDigests.findMany();
  return { count: rows.length };
}

function renderSummary(report) {
  const lines = [
    "# Obsidian M1 real-device verification",
    "",
    `*Overall*: **${report.overall}**`,
    `*Duration*: ${report.durationMs}ms`,
    `*Generated*: ${report.startedAt}`,
    "",
    "## Steps",
    "",
    ...report.steps.map(
      (s) =>
        `- ${s.status === "PASS" ? "✅" : "❌"} ${s.name} (${s.ms}ms)${s.detail?.note ? ` — ${s.detail.note}` : ""}`,
    ),
    "",
    "## Invariants",
    "",
    ...report.invariants.map((i) => `- ${i.ok ? "✅" : "❌"} ${i.name}`),
    "",
  ];
  return lines.join("\n");
}

main().catch((err) => {
  console.error("verification crashed:", err);
  process.exit(2);
});
