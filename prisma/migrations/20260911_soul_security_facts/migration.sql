-- Candidate-only append-only Soul security facts. No Convex transport or production capability.
CREATE TABLE IF NOT EXISTS soul_security_facts (
  id VARCHAR(36) NOT NULL,
  factKind VARCHAR(32) NOT NULL,
  subjectLegacyId VARCHAR(191) NOT NULL,
  actorLegacyId VARCHAR(191) NULL,
  state VARCHAR(32) NOT NULL,
  payload JSON NOT NULL,
  idempotencyKey VARCHAR(191) NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY soul_security_fact_idempotency_key (idempotencyKey),
  KEY soul_security_fact_subject_idx (subjectLegacyId, factKind, createdAt)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS soul_security_audit_chain (
  sequenceNo BIGINT NOT NULL AUTO_INCREMENT,
  eventId VARCHAR(36) NOT NULL,
  factId VARCHAR(36) NOT NULL,
  action VARCHAR(64) NOT NULL,
  subjectLegacyId VARCHAR(191) NOT NULL,
  actorLegacyId VARCHAR(191) NULL,
  idempotencyKey VARCHAR(191) NOT NULL,
  previousHash CHAR(64) NULL,
  eventHash CHAR(64) NOT NULL,
  payload JSON NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (sequenceNo),
  UNIQUE KEY soul_security_audit_event_id_key (eventId),
  UNIQUE KEY soul_security_audit_fact_idempotency_key (idempotencyKey),
  UNIQUE KEY soul_security_audit_event_hash_key (eventHash),
  KEY soul_security_audit_subject_idx (subjectLegacyId, sequenceNo),
  CONSTRAINT soul_security_audit_fact_fk FOREIGN KEY (factId) REFERENCES soul_security_facts(id) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS soul_acl_grants (
  id VARCHAR(36) NOT NULL,
  soulLegacyId VARCHAR(191) NOT NULL,
  subjectLegacyId VARCHAR(191) NOT NULL,
  role VARCHAR(32) NOT NULL,
  resource VARCHAR(32) NOT NULL,
  action VARCHAR(32) NOT NULL,
  effect VARCHAR(8) NOT NULL,
  reason VARCHAR(255) NULL,
  expiresAt DATETIME(3) NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY soul_acl_grant_key (soulLegacyId, subjectLegacyId, role, resource, action),
  KEY soul_acl_lookup_idx (soulLegacyId, subjectLegacyId, resource, action, effect)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;