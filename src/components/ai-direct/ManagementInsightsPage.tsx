import { useCallback, useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import {
  aiDirectManagementInsightsApi as api,
  type CostEntry,
  type Employee,
  type Overview,
  type SystemStatus,
} from '../../lib/aiDirectManagementInsightsApi';

type View = 'overview' | 'system' | 'employees' | 'costs';

const formatMicros = (value: string) => `$${(Number(value) / 1_000_000).toFixed(4)}`;
const formatDate = (value: string | null) => value ? new Date(value).toLocaleString() : '—';

function Scope({ organizationId, onChange }: { organizationId: string; onChange: (value: string) => void }) {
  return <label className="text-sm font-medium">组织 ID<Input value={organizationId} onChange={(event) => onChange(event.target.value)} placeholder="组织 ID" /></label>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <Card><CardHeader><CardDescription>{label}</CardDescription><CardTitle>{value}</CardTitle></CardHeader></Card>;
}

export function ManagementInsightsPage({ view }: { view: View }) {
  const [organizationId, setOrganizationId] = useState('');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [costs, setCosts] = useState<CostEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (cursor?: string) => {
    if (!organizationId.trim()) { setError('请输入组织 ID。'); return; }
    setLoading(true); setError(null);
    try {
      if (view === 'overview') setOverview(await api.overview(organizationId.trim()));
      if (view === 'system') setSystem(await api.systemStatus(organizationId.trim()));
      if (view === 'employees') {
        const page = await api.employees(organizationId.trim(), cursor);
        setEmployees((current) => cursor ? [...current, ...page.items] : page.items); setNextCursor(page.nextCursor);
      }
      if (view === 'costs') {
        const page = await api.costs(organizationId.trim(), cursor);
        setCosts((current) => cursor ? [...current, ...page.items] : page.items); setNextCursor(page.nextCursor);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取失败'); }
    finally { setLoading(false); }
  }, [organizationId, view]);

  useEffect(() => { setOverview(null); setSystem(null); setEmployees([]); setCosts([]); setNextCursor(null); }, [view, organizationId]);

  return <div className="section flex flex-col gap-5">
    <header className="section-header"><div><h1 className="section-title">{({ overview: '经营总览', system: '系统状态', employees: 'AI 员工目录', costs: '成本账本' } as const)[view]}</h1><p className="section-subtitle">仅展示组织范围内的脱敏运行事实，不包含提示词、凭据或执行载荷。</p></div></header>
    <Card><CardContent className="flex flex-wrap items-end gap-3"><Scope organizationId={organizationId} onChange={setOrganizationId} /><Button loading={loading} onClick={() => void load()}>{loading ? '读取中…' : '查询'}</Button></CardContent></Card>
    {error ? <p role="alert" className="rounded-md border border-status-error-fg/20 bg-status-error-bg p-3 text-sm text-status-error-fg">{error}</p> : null}
    {overview ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Metric label="在职 AI 员工" value={overview.employees.active} /><Metric label="待审批" value={overview.approvals.pending} /><Metric label="运行中 / 排队" value={`${overview.runs.active} / ${overview.runs.queued}`} /><Metric label="近 30 天成本" value={formatMicros(overview.costs.micros)} /></div> : null}
    {system ? <div className="flex flex-col gap-4"><div className="grid gap-4 md:grid-cols-4"><Metric label="排队运行" value={system.runs.queued} /><Metric label="活跃运行" value={system.runs.active} /><Metric label="失败运行" value={system.runs.failed} /><Metric label="过期租约" value={system.runs.expired} /></div><Card><CardHeader><CardTitle>Worker</CardTitle><CardDescription>仅显示组织关联的运行租约。</CardDescription></CardHeader><CardContent>{system.workers.length ? system.workers.map((worker) => <p key={worker.workerId}>{worker.workerId} · {worker.activeRuns} 个活跃运行 · 最近心跳 {formatDate(worker.lastHeartbeatAt)}</p>) : <p>当前没有活跃 Worker。</p>}</CardContent></Card><Card><CardHeader><CardTitle>Outbox</CardTitle></CardHeader><CardContent><p>待投递 {system.outbox.pending} 条；最早待投递 {formatDate(system.outbox.oldestPendingAt)}</p></CardContent></Card></div> : null}
    {view === 'employees' && employees.length ? <Card><CardHeader><CardTitle>在职 AI 员工</CardTitle></CardHeader><CardContent className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th>员工</th><th>公司</th><th>岗位</th><th>状态</th><th>入职时间</th></tr></thead><tbody>{employees.map((item) => <tr key={item.id}><td>{item.agentName}</td><td>{item.companyName}</td><td>{item.roleName}</td><td>{item.status}</td><td>{formatDate(item.startedAt)}</td></tr>)}</tbody></table></CardContent></Card> : null}
    {view === 'costs' && costs.length ? <Card><CardHeader><CardTitle>模型运行成本</CardTitle><CardDescription>金额为 USD；成本以微美元存储并在展示层格式化。</CardDescription></CardHeader><CardContent className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th>时间</th><th>模型</th><th>输入 / 输出 Token</th><th>成本</th><th>状态</th></tr></thead><tbody>{costs.map((item) => <tr key={item.id}><td>{formatDate(item.createdAt)}</td><td>{item.modelKey}</td><td>{item.inputTokens ?? 0} / {item.outputTokens ?? 0}</td><td>{formatMicros(item.costMicros)}</td><td>{item.status}</td></tr>)}</tbody></table></CardContent></Card> : null}
    {nextCursor ? <Button disabled={loading} onClick={() => void load(nextCursor)}>加载更多</Button> : null}
  </div>;
}