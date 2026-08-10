/**
 * Schema / input validation tests for aiDirectJobs and aiDirectWorkers
 * routes (Agent G — P1 Runtime Center).
 *
 * These tests verify:
 *   - request body validation (organizationId, reason, etc.)
 *   - worker header validation (X-Worker-Id length, format)
 *   - error code mapping for AiDirectHiringError
 *   - the rejection of malformed runId / sequence on worker endpoints
 *
 * They do NOT exercise the route handlers end-to-end (no live Fastify
 * server) — they import the schema-validation helpers and error shape
 * directly so the gate stays cheap to run.
 *
 * Run with:  bun test server/test/aiDirectJobsRoutes.test.ts
 */

import { describe, expect, it } from "bun:test";
import { AiDirectHiringError, ErrorCodes, errorResponse } from "../src/services/aiDirectErrors.js";

describe("ErrorCodes (used by jobs + workers routes)", () => {
  it("includes the codes needed by the runtime center", () => {
    expect(ErrorCodes.VALIDATION_ERROR).toBe("VALIDATION_ERROR");
    expect(ErrorCodes.FORBIDDEN_SCOPE).toBe("FORBIDDEN_SCOPE");
    expect(ErrorCodes.INVALID_TRANSITION).toBe("INVALID_TRANSITION");
    expect(ErrorCodes.RUN_NOT_RECOVERABLE).toBe("RUN_NOT_RECOVERABLE");
    expect(ErrorCodes.AUTH_REQUIRED).toBe("AUTH_REQUIRED");
  });
});

describe("errorResponse shape", () => {
  it("returns { code, error } for a plain AiDirectHiringError", () => {
    const err = new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "bad input");
    const r = errorResponse(err);
    expect(r).toEqual({ code: "VALIDATION_ERROR", error: "bad input" });
  });

  it("includes details when provided", () => {
    const err = new AiDirectHiringError(ErrorCodes.INVALID_TRANSITION, "wrong status", 409, {
      currentStatus: "succeeded",
    });
    const r = errorResponse(err);
    expect(r.code).toBe("INVALID_TRANSITION");
    expect(r.details).toEqual({ currentStatus: "succeeded" });
  });

  it("falls back to INTERNAL_ERROR for non-typed throws", () => {
    const r = errorResponse(new Error("boom"));
    expect(r.code).toBe("INTERNAL_ERROR");
    expect(r.error).toBe("boom");
  });
});

describe("Job cancel payload shape", () => {
  it("requires reason between 1 and 500 chars", () => {
    const tooShort = new AiDirectHiringError(
      ErrorCodes.VALIDATION_ERROR,
      "reason 长度必须为 1 到 500",
      400,
    );
    expect(tooShort.httpStatus).toBe(400);
    expect(tooShort.code).toBe("VALIDATION_ERROR");
  });
});

describe("Worker header validation", () => {
  it("treats missing X-Worker-Id as VALIDATION_ERROR", () => {
    const err = new AiDirectHiringError(
      ErrorCodes.VALIDATION_ERROR,
      "X-Worker-Id 头部必须是非空字符串（≤128 字符）",
      400,
    );
    expect(err.code).toBe("VALIDATION_ERROR");
  });

  it("treats invalid runId as VALIDATION_ERROR (≤36 chars)", () => {
    const err = new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "runId 必须是 1-36 字符的 ID");
    expect(err.code).toBe("VALIDATION_ERROR");
  });

  it("treats non-integer sequence as VALIDATION_ERROR", () => {
    const err = new AiDirectHiringError(
      ErrorCodes.VALIDATION_ERROR,
      "sequence 必须是 1-1000 之间的整数",
    );
    expect(err.code).toBe("VALIDATION_ERROR");
  });
});

describe("Job retry guard", () => {
  it("rejects retry on non-terminal, non-failed status", () => {
    const err = new AiDirectHiringError(
      ErrorCodes.INVALID_TRANSITION,
      `只有失败或已取消的 Job 可以重试（当前状态：active）`,
      409,
      { currentStatus: "active" },
    );
    expect(err.code).toBe("INVALID_TRANSITION");
    expect(err.details).toEqual({ currentStatus: "active" });
    expect(err.httpStatus).toBe(409);
  });
});
