import { useCallback, useState } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { getFastifyAccessToken } from '../../lib/fastifyAuthToken';

type Approval = { id: string; targetType: string; targetId: string; status: string; requestedByUserId: string; approverUserId: string | null; decisionReason: string | null; expiresAt: string | null; createdAt: string };
const base = '/api/v1/ai-direct-hiring/approvals';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const send = async (refresh: boolean) => {
    const token = await getFastifyAccessToken(refresh);
    return fetch(`${base}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, credentials: 'omit' });
  };
  let response = await send(false);
  if (response.status === 401) response = await send(true);
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error ?? `HTTP ${response.status}`); }
  return response.json() as Promise<T>;
}

export function ApprovalCenterPage() {
  const [organizationId, setOrganizationId] = useState('');
  const [items, setItems] = useState<Approval[]>([]);
  const [scope, setScope] = useState<'organization' | 'mine'>('organization');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!organizationId.trim()) return setError('请输入组织 ID。');
    setLoading(true); setError(null);
    try { const query = new URLSearchParams({ organizationId: organizationId.trim(), status: 'pending', scope }); setItems((await call<{ items: Approval[] }>(`?${query}`)).items); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '读取待办失败'); } finally { setLoading(false); }
  }, [organizationId, scope]);
  const decide = async (id: string, action: 'approve' | 'reject') => {
    const reason = action === 'reject' ? window.prompt('请填写拒绝原因（必填）')?.trim() : undefined;
    if (action === 'reject' && !reason) return;
    setLoading(true); setError(null);
    try { await call(`/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: JSON.stringify(reason ? { reason } : {}) }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '审批失败'); } finally { setLoading(false); }
  };
  const delegate = async (id: string) => {
    const toUserId = window.prompt('请输入受委派人的用户 ID')?.trim();
    if (!toUserId) return;
    const reason = window.prompt('请输入委派原因（可选）')?.trim();
    setLoading(true); setError(null);
    try { await call(`/${encodeURIComponent(id)}/delegate`, { method: 'POST', body: JSON.stringify({ toUserId, ...(reason ? { reason } : {}) }) }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '委派失败'); } finally { setLoading(false); }
  };
  return <div className="section flex flex-col gap-5"><header className="section-header"><div><h1 className="section-title">统一审批中心</h1><p className="section-subtitle">只展示组织范围内的待审批事项。最终业务状态仍由所属领域事务更新。</p></div></header><Card><CardContent className="flex flex-wrap items-end gap-3"><label className="text-sm font-medium">组织 ID<Input value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} /></label><select className="min-h-10 rounded-md border px-3 text-sm" value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}><option value="organization">组织待办</option><option value="mine">我的待办</option></select><Button loading={loading} onClick={() => void load()}>查询待办</Button></CardContent></Card>{error ? <p role="alert" className="rounded-md border border-status-error-fg/20 bg-status-error-bg p-3 text-sm text-status-error-fg">{error}</p> : null}<div className="flex flex-col gap-3">{items.map((item) => <Card key={item.id}><CardHeader><CardTitle>{item.targetType} · {item.targetId}</CardTitle></CardHeader><CardContent className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-[color:var(--ink-soft)]">请求人 {item.requestedByUserId} · 指定审批人 {item.approverUserId ?? '未指定'} · 到期 {item.expiresAt ? new Date(item.expiresAt).toLocaleString() : '—'}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={loading} onClick={() => void delegate(item.id)}>委派</Button><Button size="sm" disabled={loading} onClick={() => void decide(item.id, 'approve')}>批准</Button><Button size="sm" variant="destructive" disabled={loading} onClick={() => void decide(item.id, 'reject')}>拒绝</Button></div></CardContent></Card>)}{!loading && !error && items.length === 0 ? <p className="text-sm text-[color:var(--ink-soft)]">暂无待审批事项。</p> : null}</div></div>;
}