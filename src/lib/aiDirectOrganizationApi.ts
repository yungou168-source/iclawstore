import { getFastifyAccessToken } from './fastifyAuthToken';

const BASE = '/api/v1/ai-direct-hiring';

export type OrganizationRole = 'owner' | 'admin' | 'manager' | 'member';
export type CompanyRole = 'owner' | 'admin' | 'manager' | 'recruiter';
export type ResourceStatus = 'active' | 'inactive' | 'archived';

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface OrganizationDto {
  id: string;
  name: string;
  slug: string;
  status: ResourceStatus;
  role: OrganizationRole;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationMemberDto {
  userId: string;
  role: OrganizationRole;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export interface CompanyDto {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  status: ResourceStatus;
  organizationRole: OrganizationRole;
  companyRole: CompanyRole | null;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CompanyMemberDto {
  userId: string;
  role: CompanyRole;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDto {
  id: string;
  companyId: string;
  companyName: string;
  name: string;
  slug: string;
  status: ResourceStatus;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentRoleDto {
  id: string;
  companyId: string;
  projectId: string | null;
  name: string;
  status: 'open' | 'filled' | 'cancelled';
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const send = async (refresh: boolean) => {
    const headers = new Headers(options.headers);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const token = await getFastifyAccessToken(refresh);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(`${BASE}${path}`, { ...options, headers, credentials: 'omit' });
  };
  let response = await send(false);
  if (response.status === 401) response = await send(true);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? payload.message ?? `HTTP ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function listPath(path: string, query: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  const suffix = params.toString();
  return suffix ? `${path}?${suffix}` : path;
}

export const aiDirectOrganizationApi = {
  listOrganizations: (status?: ResourceStatus, cursor?: string) =>
    request<CursorPage<OrganizationDto>>(listPath('/organizations', { status, cursor })),
  createOrganization: (name: string) =>
    request<OrganizationDto>('/organizations', { method: 'POST', body: JSON.stringify({ name }) }),
  listOrganizationMembers: (organizationId: string) =>
    request<{ items: OrganizationMemberDto[] }>(`/organizations/${encodeURIComponent(organizationId)}/members`),
  upsertOrganizationMember: (organizationId: string, userId: string, role: OrganizationRole, status = 'active') =>
    request<OrganizationMemberDto>(
      `/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`,
      { method: 'PUT', body: JSON.stringify({ role, status }) },
    ),
  revokeOrganizationMember: (organizationId: string, userId: string) =>
    request<void>(`/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    }),
  listCompanies: (organizationId: string, status?: ResourceStatus, cursor?: string) =>
    request<CursorPage<CompanyDto>>(listPath('/companies', { organizationId, status, cursor })),
  createCompany: (organizationId: string, name: string) =>
    request<CompanyDto>('/companies', { method: 'POST', body: JSON.stringify({ organizationId, name }) }),
  updateCompany: (companyId: string, input: { name?: string; status?: ResourceStatus }) =>
    request<CompanyDto>(`/companies/${encodeURIComponent(companyId)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  archiveCompany: (companyId: string) =>
    request<CompanyDto>(`/companies/${encodeURIComponent(companyId)}`, { method: 'DELETE' }),
  listCompanyMembers: (companyId: string) =>
    request<{ items: CompanyMemberDto[] }>(`/companies/${encodeURIComponent(companyId)}/members`),
  upsertCompanyMember: (companyId: string, userId: string, role: CompanyRole, status = 'active') =>
    request<CompanyMemberDto>(`/companies/${encodeURIComponent(companyId)}/members/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      body: JSON.stringify({ role, status }),
    }),
  revokeCompanyMember: (companyId: string, userId: string) =>
    request<void>(`/companies/${encodeURIComponent(companyId)}/members/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    }),
  listProjects: (companyId: string, status?: ResourceStatus, cursor?: string) =>
    request<CursorPage<ProjectDto>>(listPath('/projects', { companyId, status, cursor })),
  createProject: (companyId: string, name: string) =>
    request<ProjectDto>('/projects', { method: 'POST', body: JSON.stringify({ companyId, name }) }),
  updateProject: (projectId: string, input: { name?: string; status?: ResourceStatus }) =>
    request<ProjectDto>(`/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  listRoles: (projectId: string, status?: AgentRoleDto['status'], cursor?: string) =>
    request<CursorPage<AgentRoleDto>>(
      listPath(`/projects/${encodeURIComponent(projectId)}/roles`, { status, cursor }),
    ),
  createRole: (projectId: string, name: string) =>
    request<AgentRoleDto>(`/projects/${encodeURIComponent(projectId)}/roles`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  updateRole: (roleId: string, input: { name?: string; status?: AgentRoleDto['status'] }) =>
    request<AgentRoleDto>(`/roles/${encodeURIComponent(roleId)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
};