# Managed Asset Migration Handoff

## Current implementation boundary

Managed assets now have a single access-policy module and a Prisma-backed repository boundary. The repository stores upload-ticket hashes and asset metadata separately from physical files; `ManagedAssetStore` remains the only filesystem port.

Implemented invariants:

- Upload tickets are bound to user, asset kind, target, size/MIME policy, expiry, and one-time consumption.
- Plaintext upload tokens are never persisted; only SHA-256 token hashes are stored.
- Upload completion stores the file first, creates metadata, and consumes the ticket. If metadata or ticket finalization fails, the stored file is moved to the managed trash area.
- Download authorization requires `active` and `clean` state. Public assets are readable anonymously; authenticated and owner assets require the corresponding user.
- Downloads expose `ETag` from the recorded SHA-256, `Content-Length`, detected `Content-Type`, `nosniff`, and safe attachment names.
- Physical storage keys are never returned as public URLs.

## HTTP boundary

- `POST /api/assets/tickets` creates an authenticated upload ticket.
- `POST /api/assets/tickets/:id/complete` accepts one multipart file and completes the ticket.
- `GET /api/assets/:id/download` performs state and access checks before streaming the managed file.

Artifact and avatar callers must use this boundary instead of writing storage keys directly. Scanner workers must transition metadata from `pending` to `clean` or `blocked`; upload completion intentionally does not make an asset downloadable before a clean scanner result.

## Candidate migration checkpoint (2026-03-14)

The isolated candidate database `iclawstore_candidate` has all 39 Prisma migrations applied. `prisma validate`, `prisma generate`, and `prisma migrate status` passed. During deployment, MySQL rejected two long `utf8mb4` indexes; the candidate was recovered with Prisma's `migrate resolve --rolled-back` procedure and replay-safe `CREATE TABLE IF NOT EXISTS` guards. No production database or application read/write mode was changed.

The repaired indexes use bounded prefix lengths to satisfy MySQL's 3072-byte limit. This is not yet production-ready evidence because the database prefix constraints do not exactly match the Prisma schema's full-field `@@unique` declarations. Before any production migration, replace this with an explicitly modelled hash-key constraint or obtain a reviewed schema/constraint decision. The real scanner command and the pending/clean/blocked/failed-retry/SHA-256 and ticket replay gates also remain to be executed.



## Candidate Prisma migration checkpoint (2026-03-14)

- The isolated candidate database `iclawstore_candidate` has all 39 Prisma migrations applied; `prisma validate`, `prisma generate`, and `prisma migrate status` passed.
- The migration was expand-only: it did not activate asset routes, scanner workers, read cutovers, or write authority. Production remains unchanged.
- Two MySQL 3072-byte index failures were recovered with Prisma `migrate resolve --rolled-back` and replay-safe table creation. The repaired prefix indexes require a reviewed hash-key/schema alignment before production migration.
- Candidate real scanner execution remains pending. Required evidence is still pending → clean, pending → blocked, failed retry, byte/SHA-256 mismatch rejection, blocked/pending download denial, ticket expiry, user/target binding, and single-consumption replay rejection.


The repository adapter requires the Prisma client generated from the current schema and an applied MySQL migration before production use. Prisma Client has been generated successfully; migration deployment remains pending because the current execution environment has no `DATABASE_URL`. Fastify HTTP regression tests cover download headers and missing-asset behavior; the real-MySQL gate still must cover ticket expiry/replay, unauthorized downloads, blocked assets, metadata rollback, and response headers. Artifact downloads remain unavailable until those tests and the migration are complete.