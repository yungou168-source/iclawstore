import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import { createPool, type Pool } from 'mysql2/promise';
import { createAiDirectCoreRoutes } from '../src/routes/aiDirectCore.js';
import { AiDirectHiringError, errorResponse } from '../src/services/aiDirectErrors.js';
import { ManagedAssetStore } from '../src/services/managedAssetStore.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('AI Direct recruitment core MySQL closure', () => {
  let app: FastifyInstance;
  let pool: Pool;
  let authorization: string;
  let developerAuthorization: string;
  let assetRoot: string;

  beforeAll(async () => {
    pool = createPool({ uri: databaseUrl!, connectionLimit: 1 });
    app = Fastify({ logger: false });
    await app.register(jwt, { secret: 'ai-direct-core-integration-secret' });
    app.decorate('mysql', pool);
    app.decorate('authenticate', async (request) => {
      await request.jwtVerify();
    });
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof AiDirectHiringError) {
        return reply.status(error.httpStatus).send(errorResponse(error));
      }
      const statusCode = typeof (error as any)?.statusCode === 'number' ? (error as any).statusCode : 500;
      return reply.status(statusCode).send({
        code: (error as any)?.code,
        error: error instanceof Error ? error.message : 'Internal Server Error',
      });
    });
    assetRoot = await mkdtemp(join(tmpdir(), 'clawhub-appearance-mysql-'));
    const assetStore = new ManagedAssetStore(assetRoot);
    await assetStore.initialize();
    await app.register(createAiDirectCoreRoutes(assetStore), { prefix: '/api/v1/ai-direct-hiring' });
    await app.ready();

    const userId = 'integration-owner';
    const developerId = 'integration-developer';
    const agentId = '00000000-0000-4000-8000-000000000001';
    const versionId = '00000000-0000-4000-8000-000000000002';
    await pool.query(
      `INSERT INTO ai_direct_agents
       (id, ownerUserId, name, status, createdAt, updatedAt)
       VALUES (?, ?, 'Integration Agent', 'active', NOW(), NOW())`,
      [agentId, developerId],
    );
    await pool.query(
      `INSERT INTO ai_direct_agent_versions
       (id, agentId, version, status, promptSpec, modelPolicy, executionPolicy, createdByUserId, createdAt)
       VALUES (?, ?, 1, 'published', '{}', '{}', '{}', ?, NOW())`,
      [versionId, agentId, userId],
    );
    authorization = `Bearer ${app.jwt.sign({ id: userId, role: 'user' })}`;
    developerAuthorization = `Bearer ${app.jwt.sign({ id: developerId, role: 'user' })}`;
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    if (assetRoot) await rm(assetRoot, { recursive: true, force: true });
  });

  const request = async (
    method: string,
    path: string,
    body?: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) => {
    const response = await app.inject({
      method,
      url: `/api/v1/ai-direct-hiring${path}`,
      headers: { authorization, ...headers },
      payload: body,
    });
    return {
      status: response.statusCode,
      body: response.body ? JSON.parse(response.body) : null,
    };
  };

  it('closes organization through terminated employment with stable replay errors', async () => {
    const unauthenticated = await app.inject({
      method: 'GET',
      url: '/api/v1/ai-direct-hiring/organizations',
    });
    expect(unauthenticated.statusCode).toBe(401);

    const organization = await request(
      'POST',
      '/organizations',
      { name: 'Integration Organization' },
      { 'idempotency-key': 'integration-organization-1' },
    );
    expect(organization.status).toBe(201);

    const replay = await request(
      'POST',
      '/organizations',
      { name: 'Integration Organization' },
      { 'idempotency-key': 'integration-organization-1' },
    );
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(organization.body.id);
    expect(replay.body.replayed).toBe(true);

    const conflict = await request(
      'POST',
      '/organizations',
      { name: 'Different Organization' },
      { 'idempotency-key': 'integration-organization-1' },
    );
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const company = await request('POST', '/companies', {
      organizationId: organization.body.id,
      name: 'Integration Company',
    });
    expect(company.status).toBe(201);

    const project = await request('POST', '/projects', {
      companyId: company.body.id,
      name: 'Integration Project',
      budgetMicros: 1000000,
    });
    expect(project.status).toBe(201);

    const role = await request('POST', `/projects/${project.body.id}/roles`, {
      name: 'Integration Role',
      responsibilities: { objective: 'Verify recruitment closure' },
      requiredCapabilities: { tools: ['http'] },
      budgetMicros: 500000,
    });
    expect(role.status).toBe(201);

    const department = await request('POST', '/workforce/departments', {
      companyId: company.body.id,
      name: 'Integration Engineering',
      sortOrder: 1,
    });
    expect(department.status).toBe(201);

    const position = await request('POST', '/workforce/positions', {
      departmentId: department.body.id,
      name: 'Integration Analyst',
      headcountTarget: 1,
      requirementsSummary: { capabilities: ['http'] },
      sortOrder: 1,
    });
    expect(position.status).toBe(201);
    const openedPosition = await request(
      'PATCH',
      `/workforce/positions/${position.body.id}`,
      { toStatus: 'open' },
    );
    expect(openedPosition.status).toBe(200);
    const roleBinding = await request(
      'POST',
      `/workforce/positions/${position.body.id}/roles`,
      { roleId: role.body.id },
    );
    expect(roleBinding.status).toBe(201);

    const offer = await request('POST', '/offers', {
      roleId: role.body.id,
      agentVersionId: '00000000-0000-4000-8000-000000000002',
      companyId: company.body.id,
      projectId: project.body.id,
      terms: { rateMicros: 500000 },
    });
    expect(offer.status).toBe(201);

    const submitted = await request('POST', `/offers/${offer.body.id}/submit`);
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe('pending_approval');
    expect(submitted.body.approvalId).toBeString();

    const bypassApproval = await request('POST', `/offers/${offer.body.id}/approve`);
    expect(bypassApproval.status).toBe(409);
    expect(bypassApproval.body.code).toBe('INVALID_TRANSITION');

    const bypassSend = await request('POST', `/offers/${offer.body.id}/send`);
    expect(bypassSend.status).toBe(409);
    expect(bypassSend.body.code).toBe('INVALID_TRANSITION');

    const approvals = await request(
      'GET',
      `/approvals?organizationId=${organization.body.id}&status=pending`,
    );
    expect(approvals.status).toBe(200);
    const approval = approvals.body.items.find((item: any) => item.targetId === offer.body.id);
    expect(approval?.id).toBe(submitted.body.approvalId);

    const approved = await request('POST', `/approvals/${approval.id}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('approved');
    expect(approved.body.decision).toBe('approved');

    const accepted = await request('POST', `/offers/${offer.body.id}/accept`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe('accepted');
    expect(accepted.body.acceptedAt).not.toBeNull();

    const employment = { body: { id: accepted.body.employmentId } };
    const duplicateEmployment = await request('POST', '/employments', { offerId: offer.body.id });
    expect(duplicateEmployment.status).toBe(409);
    expect(duplicateEmployment.body.code).toBe('INVALID_TRANSITION');

    const secondCompanyId = '00000000-0000-4000-8000-000000000010';
    const secondRoleId = '00000000-0000-4000-8000-000000000011';
    const secondEmploymentId = '00000000-0000-4000-8000-000000000012';
    await pool.query(
      `INSERT INTO ai_direct_companies
         (id, organizationId, name, slug, status, createdByUserId, createdAt, updatedAt)
       VALUES (?, ?, 'Second Integration Company', 'second-integration-company', 'active',
               'integration-owner', NOW(3), NOW(3))`,
      [secondCompanyId, organization.body.id],
    );
    await pool.query(
      `INSERT INTO ai_direct_agent_roles
         (id, companyId, projectId, name, responsibilities, requiredCapabilities,
          budgetMicros, status, createdByUserId, createdAt, updatedAt)
       VALUES (?, ?, NULL, 'Second Integration Role', '{}', '{}', 0, 'open',
               'integration-owner', NOW(3), NOW(3))`,
      [secondRoleId, secondCompanyId],
    );
    await pool.query(
      `INSERT INTO ai_direct_employments
         (id, companyId, agentId, agentVersionId, roleId, projectId, offerId,
          requestedByUserId, status, createdAt, updatedAt)
       VALUES (?, ?, '00000000-0000-4000-8000-000000000001',
               '00000000-0000-4000-8000-000000000002', ?, NULL,
               '00000000-0000-4000-8000-000000000013', 'integration-owner',
               'offered', NOW(3), NOW(3))`,
      [secondEmploymentId, secondCompanyId, secondRoleId],
    );
    await pool.query(
      `INSERT INTO ai_direct_employment_events
         (id, employmentId, sequence, fromStatus, toStatus, actorUserId, reason, occurredAt)
       VALUES ('00000000-0000-4000-8000-000000000014', ?, 1, NULL, 'offered',
               'integration-owner', 'integration conflict fixture', NOW(3))`,
      [secondEmploymentId],
    );

    const competingAttempt = await request(
      'POST',
      `/employments/${secondEmploymentId}/transition`,
      { toStatus: 'accepted', reason: 'integration:competing-accept' },
    );
    expect(competingAttempt.status).toBe(409);
    expect(competingAttempt.body.code).toBe('APPEARANCE_CONTROL_CONFLICT');

    for (const toStatus of [
      'onboarding',
      'active',
      'paused',
      'active',
      'offboarding',
      'terminated',
    ]) {
      const transition = await request(
        'POST',
        `/employments/${employment.body.id}/transition`,
        { toStatus, reason: `integration:${toStatus}` },
      );
      if (transition.status !== 200) {
        throw new Error(
          `Employment transition to ${toStatus} failed (${transition.status}): ${JSON.stringify(transition.body)}`,
        );
      }
      expect(transition.body.status).toBe(toStatus);

      if (toStatus === 'onboarding') {
        const developerView = await request(
          'GET',
          '/agents/00000000-0000-4000-8000-000000000001/appearance',
          undefined,
          { authorization: developerAuthorization },
        );
        expect(developerView.status).toBe(200);
        expect(developerView.body.control).toMatchObject({
          controllerEmploymentId: employment.body.id,
          controllerCompanyId: company.body.id,
          canWrite: false,
          readOnlyReason: 'controlled_by_employer',
        });
        const developerWrite = await request(
          'PATCH',
          '/agents/00000000-0000-4000-8000-000000000001/appearance',
          { defaultMode: 'model_3d' },
          {
            authorization: developerAuthorization,
            'if-match': `"appearance-${developerView.body.revision}"`,
          },
        );
        expect(developerWrite.status).toBe(403);
        expect(developerWrite.body.code).toBe('FORBIDDEN_SCOPE');

        const companyView = await request(
          'GET',
          '/agents/00000000-0000-4000-8000-000000000001/appearance',
        );
        expect(companyView.body.control.canWrite).toBe(true);
        expect(companyView.body.control.authority).toBe('company');
        const companyWrite = await request(
          'PATCH',
          '/agents/00000000-0000-4000-8000-000000000001/appearance',
          { defaultMode: 'model_3d' },
          { 'if-match': `"appearance-${companyView.body.revision}"` },
        );
        expect(companyWrite.status).toBe(200);
      }

      if (toStatus === 'terminated') {
        const developerView = await request(
          'GET',
          '/agents/00000000-0000-4000-8000-000000000001/appearance',
          undefined,
          { authorization: developerAuthorization },
        );
        expect(developerView.body.control).toMatchObject({
          controllerEmploymentId: null,
          controllerCompanyId: null,
          canWrite: true,
          authority: 'developer',
        });
        const formerCompanyWrite = await request(
          'PATCH',
          '/agents/00000000-0000-4000-8000-000000000001/appearance',
          { defaultMode: 'image_2d' },
          { 'if-match': `"appearance-${developerView.body.revision}"` },
        );
        expect(formerCompanyWrite.status).toBe(403);
        const developerWrite = await request(
          'PATCH',
          '/agents/00000000-0000-4000-8000-000000000001/appearance',
          { defaultMode: 'image_2d' },
          {
            authorization: developerAuthorization,
            'if-match': `"appearance-${developerView.body.revision}"`,
          },
        );
        expect(developerWrite.status).toBe(200);
      }
    }

    const invalidTransition = await request(
      'POST',
      `/employments/${employment.body.id}/transition`,
      { toStatus: 'active' },
    );
    expect(invalidTransition.status).toBe(409);
    expect(invalidTransition.body.code).toBe('INVALID_TRANSITION');

    const events = await request('GET', `/employments/${employment.body.id}/events`);
    expect(events.status).toBe(200);
    expect(events.body.items).toHaveLength(7);
    expect(events.body.items.at(-1).toStatus).toBe('terminated');

    const [appearanceAuditRows] = await pool.query<any[]>(
      `SELECT action FROM ai_direct_audit_events
       WHERE targetType = 'agent_appearance'
         AND targetId = '00000000-0000-4000-8000-000000000001'
       ORDER BY createdAt, id`,
    );
    const appearanceAuditActions = appearanceAuditRows.map((row) => row.action);
    for (const expectedAction of [
      'agent_appearance.default_mode.updated.v1',
      'agent_appearance.control.released.v1',
    ]) {
      expect(appearanceAuditActions).toContain(expectedAction);
    }
  }, 30000);
});