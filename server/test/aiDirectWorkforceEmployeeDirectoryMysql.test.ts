import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import jwt from "@fastify/jwt";
import Fastify, { type FastifyInstance } from "fastify";
import { createPool, type Pool } from "mysql2/promise";
import { createAiDirectCoreRoutes } from "../src/routes/aiDirectCore.js";
import { AiDirectHiringError, errorResponse } from "../src/services/aiDirectErrors.js";
import {
  createEmployeeDirectoryFixture,
  type EmployeeDirectoryFixture,
} from "./employeeDirectoryFixture.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("workforce employee directory protected API closure", () => {
  let app: FastifyInstance;
  let pool: Pool;
  let fixture: EmployeeDirectoryFixture;

  beforeAll(async () => {
    const alipayKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.ALIPAY_PAID_HIRING_ENABLED = "true";
    process.env.ALIPAY_APP_ID = "employee-directory-fixture-app";
    process.env.ALIPAY_SELLER_ID = "employee-directory-fixture-seller";
    process.env.ALIPAY_PRIVATE_KEY = alipayKeys.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    process.env.ALIPAY_PUBLIC_KEY = alipayKeys.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
    process.env.ALIPAY_NOTIFY_URL = "https://integration.invalid/alipay/notify";

    pool = createPool({ uri: databaseUrl!, connectionLimit: 1 });
    app = Fastify({ logger: false });
    await app.register(jwt, { secret: "employee-directory-integration-secret" });
    app.decorate("mysql", pool);
    app.decorate("authenticate", async (request) => {
      await request.jwtVerify();
    });
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof AiDirectHiringError) {
        return reply.status(error.httpStatus).send(errorResponse(error));
      }
      const statusCode =
        typeof (error as any)?.statusCode === "number" ? (error as any).statusCode : 500;
      return reply.status(statusCode).send({
        code: (error as any)?.code,
        error: error instanceof Error ? error.message : "Internal Server Error",
      });
    });
    await app.register(createAiDirectCoreRoutes(), { prefix: "/api/v1/ai-direct-hiring" });
    await app.ready();

    fixture = await createEmployeeDirectoryFixture(app, {
      owner: `Bearer ${app.jwt.sign({ id: "fixture-owner", role: "user" })}`,
      recruiter: `Bearer ${app.jwt.sign({ id: "fixture-recruiter", role: "user" })}`,
      outsider: `Bearer ${app.jwt.sign({ id: "fixture-outsider", role: "user" })}`,
      developer: `Bearer ${app.jwt.sign({ id: "fixture-developer", role: "user" })}`,
      reviewer: `Bearer ${app.jwt.sign({ id: "fixture-reviewer", role: "admin" })}`,
    });
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  const readDirectory = async (authorization: string, companyId: string) => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/ai-direct-hiring/workforce/employees?companyId=${companyId}&status=active`,
      headers: { authorization },
    });
    return {
      status: response.statusCode,
      body: response.body ? JSON.parse(response.body) : null,
    };
  };

  it("returns the transactionally projected employee to an authorized recruiter", async () => {
    const response = await readDirectory(
      fixture.authorizations.recruiter,
      fixture.staffedCompanyId,
    );

    expect(response.status).toBe(200);
    expect(response.body.nextCursor).toBeNull();
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({
      employmentId: fixture.employmentId,
      agentId: fixture.agentId,
      agentVersionId: fixture.agentVersionId,
      agentDisplayName: "Directory Fixture Agent",
      departmentName: "Fixture Engineering",
      positionName: "Fixture Analyst",
      roleName: "Directory Fixture Researcher",
      employmentStatus: "active",
    });
  });

  it("returns an empty 200 result for an authorized recruiter in an unstaffed company", async () => {
    const response = await readDirectory(fixture.authorizations.recruiter, fixture.emptyCompanyId);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [], nextCursor: null });
  });

  it("returns 403 before reading another company directory for a non-member", async () => {
    const response = await readDirectory(fixture.authorizations.outsider, fixture.staffedCompanyId);

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("FORBIDDEN_SCOPE");
  });
});
