import type { FastifyInstance } from 'fastify';

type FixtureAuthorizations = {
  owner: string;
  recruiter: string;
  outsider: string;
  developer: string;
};

type JsonResponse = {
  status: number;
  body: any;
};

const call = async (
  app: FastifyInstance,
  authorization: string,
  method: string,
  path: string,
  expectedStatus: number,
  payload?: Record<string, unknown>,
): Promise<JsonResponse> => {
  const response = await app.inject({
    method,
    url: `/api/v1/ai-direct-hiring${path}`,
    headers: { authorization },
    payload,
  });
  const body = response.body ? JSON.parse(response.body) : null;
  if (response.statusCode !== expectedStatus) {
    throw new Error(
      `${method} ${path} returned ${response.statusCode}, expected ${expectedStatus}: ${JSON.stringify(body)}`,
    );
  }
  return { status: response.statusCode, body };
};

export type EmployeeDirectoryFixture = {
  organizationId: string;
  staffedCompanyId: string;
  emptyCompanyId: string;
  employmentId: string;
  agentId: string;
  agentVersionId: string;
  authorizations: FixtureAuthorizations;
};

export async function createEmployeeDirectoryFixture(
  app: FastifyInstance,
  authorizations: FixtureAuthorizations,
): Promise<EmployeeDirectoryFixture> {
  const agent = await call(app, authorizations.developer, 'POST', '/agents', 201, {
    name: 'Directory Fixture Agent',
    description: 'Created through the protected publication API',
    promptSpec: { objective: 'Validate the workforce directory' },
    modelPolicy: { provider: 'fixture' },
  });

  const organization = await call(app, authorizations.owner, 'POST', '/organizations', 201, {
    name: 'Employee Directory Fixture Organization',
  });
  const organizationId = organization.body.id as string;

  await call(
    app,
    authorizations.owner,
    'PUT',
    `/organizations/${organizationId}/members/fixture-recruiter`,
    200,
    { role: 'member', status: 'active' },
  );

  const staffedCompany = await call(app, authorizations.owner, 'POST', '/companies', 201, {
    organizationId,
    name: 'Staffed Fixture Company',
  });
  const emptyCompany = await call(app, authorizations.owner, 'POST', '/companies', 201, {
    organizationId,
    name: 'Empty Fixture Company',
  });

  for (const companyId of [staffedCompany.body.id, emptyCompany.body.id] as string[]) {
    await call(
      app,
      authorizations.owner,
      'PUT',
      `/companies/${companyId}/members/fixture-recruiter`,
      200,
      { role: 'recruiter', status: 'active' },
    );
  }

  const project = await call(app, authorizations.owner, 'POST', '/projects', 201, {
    companyId: staffedCompany.body.id,
    name: 'Directory Fixture Project',
    budgetMicros: 1_000_000,
  });
  const role = await call(
    app,
    authorizations.owner,
    'POST',
    `/projects/${project.body.id}/roles`,
    201,
    {
      name: 'Directory Fixture Researcher',
      responsibilities: { objective: 'Validate directory projection' },
      requiredCapabilities: { tools: ['http'] },
      budgetMicros: 500_000,
    },
  );
  const department = await call(app, authorizations.owner, 'POST', '/workforce/departments', 201, {
    companyId: staffedCompany.body.id,
    name: 'Fixture Engineering',
    sortOrder: 1,
  });
  const position = await call(app, authorizations.owner, 'POST', '/workforce/positions', 201, {
    departmentId: department.body.id,
    name: 'Fixture Analyst',
    headcountTarget: 1,
    requirementsSummary: { capabilities: ['http'] },
    sortOrder: 1,
  });
  await call(
    app,
    authorizations.owner,
    'PATCH',
    `/workforce/positions/${position.body.id}`,
    200,
    { toStatus: 'open' },
  );
  await call(
    app,
    authorizations.owner,
    'POST',
    `/workforce/positions/${position.body.id}/roles`,
    201,
    { roleId: role.body.id },
  );

  const offer = await call(app, authorizations.recruiter, 'POST', '/offers', 201, {
    roleId: role.body.id,
    agentVersionId: agent.body.activeVersionId,
    companyId: staffedCompany.body.id,
    projectId: project.body.id,
    terms: { rateMicros: 500_000 },
  });
  await call(
    app,
    authorizations.recruiter,
    'POST',
    `/offers/${offer.body.id}/submit`,
    200,
  );

  const approvals = await call(
    app,
    authorizations.owner,
    'GET',
    `/approvals?organizationId=${organizationId}&status=pending`,
    200,
  );
  const approval = approvals.body.items.find((item: any) => item.targetId === offer.body.id);
  if (!approval) throw new Error('Offer approval was not created');
  await call(app, authorizations.owner, 'POST', `/approvals/${approval.id}/approve`, 200);

  const accepted = await call(
    app,
    authorizations.recruiter,
    'POST',
    `/offers/${offer.body.id}/accept`,
    200,
  );
  await call(
    app,
    authorizations.recruiter,
    'POST',
    `/employments/${accepted.body.employmentId}/transition`,
    200,
    { toStatus: 'onboarding', reason: 'employee directory fixture' },
  );
  await call(
    app,
    authorizations.recruiter,
    'POST',
    `/employments/${accepted.body.employmentId}/transition`,
    200,
    { toStatus: 'active', reason: 'employee directory fixture' },
  );

  return {
    organizationId,
    staffedCompanyId: staffedCompany.body.id,
    emptyCompanyId: emptyCompany.body.id,
    employmentId: accepted.body.employmentId,
    agentId: agent.body.id,
    agentVersionId: agent.body.activeVersionId,
    authorizations,
  };
}