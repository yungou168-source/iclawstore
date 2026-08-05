import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from '../../lib/i18n/context';
import { useAuthStatus } from '../../lib/useAuthStatus';
import {
  aiDirectOrganizationApi as api,
  type AgentRoleDto,
  type CompanyDto,
  type CompanyMemberDto,
  type OrganizationDto,
  type OrganizationMemberDto,
  type ProjectDto,
  type ResourceStatus,
} from '../../lib/aiDirectOrganizationApi';
import { SignInPrompt } from '../SignInPrompt';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

type LoadState = 'loading' | 'ready' | 'error';

function Empty({ children }: { children: string }) {
  return <p className="rounded-lg border border-dashed border-[color:var(--line)] p-4 text-sm text-[color:var(--ink-soft)]">{children}</p>;
}

function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  const { t } = useLocale();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('ai_direct.organizations.load_error')}</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      <CardContent><Button onClick={retry}>{t('common.retry')}</Button></CardContent>
    </Card>
  );
}

function StatusFilter({ value, onChange }: { value: ResourceStatus | ''; onChange: (value: ResourceStatus | '') => void }) {
  const { t } = useLocale();
  return (
    <select className="min-h-10 rounded-md border border-[color:var(--line)] bg-[color:var(--surface)] px-3 text-sm" value={value} onChange={(event) => onChange(event.target.value as ResourceStatus | '')}>
      <option value="">{t('ai_direct.organizations.status.all')}</option>
      <option value="active">{t('ai_direct.organizations.status.active')}</option>
      <option value="inactive">{t('ai_direct.organizations.status.inactive')}</option>
      <option value="archived">{t('ai_direct.organizations.status.archived')}</option>
    </select>
  );
}

export function OrganizationAdminPage() {
  const { t } = useLocale();
  const { isAuthenticated, isLoading } = useAuthStatus();
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ResourceStatus | ''>('');
  const [organizations, setOrganizations] = useState<OrganizationDto[]>([]);
  const [organizationId, setOrganizationId] = useState('');
  const [members, setMembers] = useState<OrganizationMemberDto[]>([]);
  const [companies, setCompanies] = useState<CompanyDto[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [companyMembers, setCompanyMembers] = useState<CompanyMemberDto[]>([]);
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [projectId, setProjectId] = useState('');
  const [roles, setRoles] = useState<AgentRoleDto[]>([]);
  const [newOrganization, setNewOrganization] = useState('');
  const [newCompany, setNewCompany] = useState('');
  const [newProject, setNewProject] = useState('');
  const [newRole, setNewRole] = useState('');
  const [memberUserId, setMemberUserId] = useState('');
  const [companyMemberUserId, setCompanyMemberUserId] = useState('');

  const selectedOrganization = organizations.find((item) => item.id === organizationId) ?? null;
  const selectedCompany = companies.find((item) => item.id === companyId) ?? null;
  const selectedProject = projects.find((item) => item.id === projectId) ?? null;
  const canManageOrganization = selectedOrganization?.permissions.includes('organization.members.manage') ?? false;
  const canManageCompany = selectedCompany?.permissions.includes('company.update') ?? false;
  const canManageProjects = selectedCompany?.permissions.includes('project.manage') ?? false;
  const canManageRoles = selectedProject?.permissions.includes('agent_role.manage') ?? false;

  const loadOrganizations = useCallback(async () => {
    setState('loading');
    try {
      const page = await api.listOrganizations(status || undefined);
      setOrganizations(page.items);
      setOrganizationId((current) => page.items.some((item) => item.id === current) ? current : (page.items[0]?.id ?? ''));
      setState('ready');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('ai_direct.organizations.load_failed'));
      setState('error');
    }
  }, [status, t]);

  useEffect(() => { if (isAuthenticated) void loadOrganizations(); }, [isAuthenticated, loadOrganizations]);

  const loadOrganizationScope = useCallback(async () => {
    if (!organizationId) { setMembers([]); setCompanies([]); return; }
    try {
      const [memberPage, companyPage] = await Promise.all([
        api.listOrganizationMembers(organizationId).catch(() => ({ items: [] })),
        api.listCompanies(organizationId, status || undefined),
      ]);
      setMembers(memberPage.items);
      setCompanies(companyPage.items);
      setCompanyId((current) => companyPage.items.some((item) => item.id === current) ? current : (companyPage.items[0]?.id ?? ''));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('ai_direct.organizations.scope_load_failed'));
    }
  }, [organizationId, status, t]);

  useEffect(() => { if (isAuthenticated) void loadOrganizationScope(); }, [isAuthenticated, loadOrganizationScope]);

  const loadCompanyScope = useCallback(async () => {
    if (!companyId) { setCompanyMembers([]); setProjects([]); return; }
    try {
      const [memberPage, projectPage] = await Promise.all([
        api.listCompanyMembers(companyId).catch(() => ({ items: [] })),
        api.listProjects(companyId, status || undefined),
      ]);
      setCompanyMembers(memberPage.items);
      setProjects(projectPage.items);
      setProjectId((current) => projectPage.items.some((item) => item.id === current) ? current : (projectPage.items[0]?.id ?? ''));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('ai_direct.organizations.company_scope_load_failed'));
    }
  }, [companyId, status, t]);

  useEffect(() => { if (isAuthenticated) void loadCompanyScope(); }, [isAuthenticated, loadCompanyScope]);

  const loadRoles = useCallback(async () => {
    if (!projectId) { setRoles([]); return; }
    try { setRoles((await api.listRoles(projectId)).items); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('ai_direct.organizations.role_load_failed')); }
  }, [projectId, t]);
  useEffect(() => { if (isAuthenticated) void loadRoles(); }, [isAuthenticated, loadRoles]);

  const run = async (action: () => Promise<unknown>, refresh: () => Promise<void>) => {
    setBusy(true);
    try { await action(); await refresh(); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('ai_direct.organizations.action_failed')); }
    finally { setBusy(false); }
  };

  const summary = useMemo(() => t('ai_direct.organizations.summary', {
    members: members.length,
    companies: companies.length,
    projects: projects.length,
    roles: roles.length,
  }), [companies.length, members.length, projects.length, roles.length, t]);

  if (isLoading || (isAuthenticated && state === 'loading')) return <div className="section"><p>{t('ai_direct.organizations.loading')}</p></div>;
  if (!isAuthenticated) return <SignInPrompt title={t('ai_direct.organizations.sign_in_title')} />;
  if (state === 'error') return <div className="section"><ErrorState message={error} retry={() => void loadOrganizations()} /></div>;

  return (
    <div className="section flex flex-col gap-5">
      <div className="section-header"><div><h1 className="section-title">{t('ai_direct.organizations.title')}</h1><p className="section-subtitle">{t('ai_direct.organizations.subtitle')}</p></div><StatusFilter value={status} onChange={setStatus} /></div>
      {error && <p role="alert" className="rounded-md border border-status-error-fg/20 bg-status-error-bg p-3 text-sm text-status-error-fg">{error}</p>}

      <Card><CardHeader><CardTitle>{t('ai_direct.organizations.current')}</CardTitle><CardDescription>{summary}</CardDescription></CardHeader><CardContent>
        <div className="flex flex-wrap gap-2">{organizations.map((item) => <Button key={item.id} variant={item.id === organizationId ? 'primary' : 'outline'} onClick={() => setOrganizationId(item.id)}>{item.name}<Badge>{item.role}</Badge></Button>)}</div>
        {!organizations.length && <Empty>{t('ai_direct.organizations.empty')}</Empty>}
        <div className="flex gap-2"><Input aria-label={t('ai_direct.organizations.name_label')} placeholder={t('ai_direct.organizations.name_placeholder')} value={newOrganization} onChange={(event) => setNewOrganization(event.target.value)} /><Button loading={busy} disabled={!newOrganization.trim()} onClick={() => void run(() => api.createOrganization(newOrganization.trim()), async () => { setNewOrganization(''); await loadOrganizations(); })}>{t('ai_direct.organizations.create')}</Button></div>
      </CardContent></Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>{t('ai_direct.organizations.members')}</CardTitle><CardDescription>{t('ai_direct.organizations.members_description')}</CardDescription></CardHeader><CardContent>
          {!organizationId ? <Empty>{t('ai_direct.organizations.select_organization')}</Empty> : !members.length ? <Empty>{t('ai_direct.organizations.no_members')}</Empty> : members.map((member) => <div key={member.userId} className="flex items-center justify-between gap-3 rounded-md border border-[color:var(--line)] p-3"><span className="truncate text-sm">{member.userId}</span><div className="flex items-center gap-2"><Badge>{member.role}</Badge><Button size="xs" variant="destructive" disabled={!canManageOrganization || busy || member.status !== 'active'} onClick={() => void run(() => api.revokeOrganizationMember(organizationId, member.userId), loadOrganizationScope)}>{t('ai_direct.organizations.revoke')}</Button></div></div>)}
          <div className="grid gap-2"><Label htmlFor="org-member">{t('ai_direct.organizations.member_user_id')}</Label><div className="flex gap-2"><Input id="org-member" value={memberUserId} onChange={(event) => setMemberUserId(event.target.value)} /><Button disabled={!canManageOrganization || !memberUserId.trim()} loading={busy} onClick={() => void run(() => api.upsertOrganizationMember(organizationId, memberUserId.trim(), 'member'), async () => { setMemberUserId(''); await loadOrganizationScope(); })}>{t('ai_direct.organizations.add')}</Button></div></div>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>{t('ai_direct.organizations.companies')}</CardTitle><CardDescription>{t('ai_direct.organizations.companies_description')}</CardDescription></CardHeader><CardContent>
          {!organizationId ? <Empty>{t('ai_direct.organizations.select_organization')}</Empty> : !companies.length ? <Empty>{t('ai_direct.organizations.no_companies')}</Empty> : companies.map((company) => <div key={company.id} className="flex items-center justify-between gap-3 rounded-md border border-[color:var(--line)] p-3"><Button variant="ghost" onClick={() => setCompanyId(company.id)}>{company.name}</Button><div className="flex gap-2"><Badge>{company.status}</Badge><Button size="xs" disabled={!company.permissions.includes('company.update') || company.status !== 'active'} onClick={() => void run(() => api.updateCompany(company.id, { status: 'inactive' }), loadOrganizationScope)}>{t('ai_direct.organizations.deactivate')}</Button><Button size="xs" variant="destructive" disabled={!company.permissions.includes('company.archive') || company.status !== 'inactive'} onClick={() => void run(() => api.archiveCompany(company.id), loadOrganizationScope)}>{t('ai_direct.organizations.archive')}</Button></div></div>)}
          <div className="flex gap-2"><Input aria-label={t('ai_direct.organizations.company_name_label')} placeholder={t('ai_direct.organizations.company_name_placeholder')} value={newCompany} onChange={(event) => setNewCompany(event.target.value)} /><Button disabled={!organizationId || !newCompany.trim() || !selectedOrganization?.permissions.includes('company.create')} loading={busy} onClick={() => void run(() => api.createCompany(organizationId, newCompany.trim()), async () => { setNewCompany(''); await loadOrganizationScope(); })}>{t('ai_direct.organizations.create_company')}</Button></div>
        </CardContent></Card>
      </div>

      <Card><CardHeader><CardTitle>{t('ai_direct.organizations.company_members')}</CardTitle><CardDescription>{selectedCompany ? `${selectedCompany.name} · ${selectedCompany.companyRole ?? selectedCompany.organizationRole}` : t('ai_direct.organizations.select_company')}</CardDescription></CardHeader><CardContent>
        {!companyId ? <Empty>{t('ai_direct.organizations.select_company')}</Empty> : !companyMembers.length ? <Empty>{t('ai_direct.organizations.no_company_members')}</Empty> : companyMembers.map((member) => <div key={member.userId} className="flex items-center justify-between rounded-md border border-[color:var(--line)] p-3"><span className="text-sm">{member.userId}</span><div className="flex gap-2"><Badge>{member.role}</Badge><Button size="xs" variant="destructive" disabled={!canManageCompany || busy} onClick={() => void run(() => api.revokeCompanyMember(companyId, member.userId), loadCompanyScope)}>{t('ai_direct.organizations.revoke')}</Button></div></div>)}
        <div className="flex gap-2"><Input aria-label={t('ai_direct.organizations.company_member_user_id')} placeholder={t('ai_direct.organizations.user_id_placeholder')} value={companyMemberUserId} onChange={(event) => setCompanyMemberUserId(event.target.value)} /><Button disabled={!canManageCompany || !companyMemberUserId.trim()} loading={busy} onClick={() => void run(() => api.upsertCompanyMember(companyId, companyMemberUserId.trim(), 'recruiter'), async () => { setCompanyMemberUserId(''); await loadCompanyScope(); })}>{t('ai_direct.organizations.add_recruiter')}</Button></div>
      </CardContent></Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>{t('ai_direct.organizations.projects')}</CardTitle><CardDescription>{selectedCompany?.name ?? t('ai_direct.organizations.no_company_selected')}</CardDescription></CardHeader><CardContent>
          {!companyId ? <Empty>{t('ai_direct.organizations.select_company')}</Empty> : !projects.length ? <Empty>{t('ai_direct.organizations.no_projects')}</Empty> : projects.map((project) => <div key={project.id} className="flex items-center justify-between rounded-md border border-[color:var(--line)] p-3"><Button variant="ghost" onClick={() => setProjectId(project.id)}>{project.name}</Button><Badge>{project.status}</Badge></div>)}
          <div className="flex gap-2"><Input aria-label={t('ai_direct.organizations.project_name_label')} placeholder={t('ai_direct.organizations.project_name_placeholder')} value={newProject} onChange={(event) => setNewProject(event.target.value)} /><Button disabled={!canManageProjects || selectedCompany?.status !== 'active' || !newProject.trim()} loading={busy} onClick={() => void run(() => api.createProject(companyId, newProject.trim()), async () => { setNewProject(''); await loadCompanyScope(); })}>{t('ai_direct.organizations.create_project')}</Button></div>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>{t('ai_direct.organizations.agent_roles')}</CardTitle><CardDescription>{selectedProject?.name ?? t('ai_direct.organizations.no_project_selected')}</CardDescription></CardHeader><CardContent>
          {!projectId ? <Empty>{t('ai_direct.organizations.select_project')}</Empty> : !roles.length ? <Empty>{t('ai_direct.organizations.no_roles')}</Empty> : roles.map((role) => <div key={role.id} className="flex items-center justify-between rounded-md border border-[color:var(--line)] p-3"><span>{role.name}</span><div className="flex gap-2"><Badge>{role.status}</Badge><Button size="xs" disabled={!canManageRoles || role.status !== 'open'} onClick={() => void run(() => api.updateRole(role.id, { status: 'cancelled' }), loadRoles)}>{t('ai_direct.organizations.close')}</Button></div></div>)}
          <div className="flex gap-2"><Input aria-label={t('ai_direct.organizations.role_name_label')} placeholder={t('ai_direct.organizations.role_name_placeholder')} value={newRole} onChange={(event) => setNewRole(event.target.value)} /><Button disabled={!canManageRoles || selectedProject?.status !== 'active' || !newRole.trim()} loading={busy} onClick={() => void run(() => api.createRole(projectId, newRole.trim()), async () => { setNewRole(''); await loadRoles(); })}>{t('ai_direct.organizations.create_role')}</Button></div>
        </CardContent></Card>
      </div>
    </div>
  );
}