import { Download, Filter, RefreshCw, ShieldCheck } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import {
  aiDirectAuditApi,
  type AuditEvent,
  type AuditExportJob,
  type AuditFilters,
} from '../../lib/aiDirectAuditApi';

type Props = { initialOrganizationId?: string };

type FilterForm = {
  organizationId: string;
  from: string;
  to: string;
  actorUserId: string;
  resourceType: string;
  resourceId: string;
  action: string;
  requestId: string;
};

const dateTimeLocal = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.valueOf() - offset).toISOString().slice(0, 16);
};

function initialFilters(organizationId = ''): FilterForm {
  const to = new Date();
  const from = new Date(to.valueOf() - 24 * 60 * 60 * 1_000);
  return {
    organizationId,
    from: dateTimeLocal(from),
    to: dateTimeLocal(to),
    actorUserId: '',
    resourceType: '',
    resourceId: '',
    action: '',
    requestId: '',
  };
}

function apiFilters(form: FilterForm): AuditFilters {
  return {
    organizationId: form.organizationId.trim(),
    from: new Date(form.from).toISOString(),
    to: new Date(form.to).toISOString(),
    actorUserId: form.actorUserId.trim() || undefined,
    resourceType: form.resourceType.trim() || undefined,
    resourceId: form.resourceId.trim() || undefined,
    action: form.action.trim() || undefined,
    requestId: form.requestId.trim() || undefined,
  };
}

function EventCard({ event }: { event: AuditEvent }) {
  return (
    <Card className="gap-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-[color:var(--line)] px-2 py-1 text-xs font-semibold">{event.source}</span>
          <strong className="text-sm text-[color:var(--ink)]">{event.action}</strong>
          <span className="text-xs text-[color:var(--ink-soft)]">{event.outcome}</span>
        </div>
        <time className="text-xs text-[color:var(--ink-soft)]">{new Date(event.createdAt).toLocaleString()}</time>
      </div>
      <div className="grid gap-1 text-sm text-[color:var(--ink-soft)] md:grid-cols-2">
        <span>资源：{event.resourceType} / {event.resourceId}</span>
        <span>操作者：{event.actorUserId ?? 'system'}</span>
        <span>Request ID：{event.requestId ?? '—'}</span>
        <span>Event ID：{event.id}</span>
      </div>
      {event.metadata && Object.keys(event.metadata).length > 0 ? (
        <details className="text-xs text-[color:var(--ink-soft)]">
          <summary className="cursor-pointer font-semibold">安全元数据</summary>
          <pre className="mt-2 max-h-56 overflow-auto rounded-[var(--radius-sm)] bg-[color:var(--surface-muted)] p-3 whitespace-pre-wrap break-all">
            {JSON.stringify(event.metadata, null, 2)}
          </pre>
        </details>
      ) : null}
    </Card>
  );
}

export function AuditCenterPage({ initialOrganizationId = '' }: Props) {
  const [form, setForm] = useState<FilterForm>(() => initialFilters(initialOrganizationId));
  const [activeFilters, setActiveFilters] = useState<AuditFilters | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportJob, setExportJob] = useState<AuditExportJob | null>(null);

  const canSubmit = useMemo(
    () => Boolean(form.organizationId.trim() && form.from && form.to) && !loading,
    [form, loading],
  );

  const update = (field: keyof FilterForm) => (value: string) => setForm((current) => ({ ...current, [field]: value }));

  const load = useCallback(async (filters: AuditFilters, nextCursor: string | null, append: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const page = await aiDirectAuditApi.list(filters, nextCursor);
      setEvents((current) => append ? [...current, ...page.items] : page.items);
      setCursor(page.nextCursor);
      setActiveFilters(filters);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法读取审计事件');
    } finally {
      setLoading(false);
    }
  }, []);

  const submit = () => {
    try {
      void load(apiFilters(form), null, false);
    } catch {
      setError('组织和时间范围必须有效');
    }
  };

  const createExport = async () => {
    if (!activeFilters) return;
    setLoading(true);
    setError(null);
    try {
      const created = await aiDirectAuditApi.createExport(activeFilters);
      setExportJob(await aiDirectAuditApi.getExport(activeFilters.organizationId, created.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法创建导出任务');
    } finally {
      setLoading(false);
    }
  };

  const refreshExport = async () => {
    if (!activeFilters || !exportJob) return;
    setExportJob(await aiDirectAuditApi.getExport(activeFilters.organizationId, exportJob.id));
  };

  const download = async () => {
    if (!activeFilters || !exportJob || exportJob.status !== 'completed') return;
    const issued = await aiDirectAuditApi.createDownloadToken(activeFilters.organizationId, exportJob.id);
    window.location.assign(aiDirectAuditApi.downloadUrl(exportJob.id, issued.token));
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 md:px-8">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[color:var(--accent-deep)]"><ShieldCheck size={22} /><span className="text-sm font-semibold">组织治理</span></div>
        <h1 className="font-display text-3xl font-bold text-[color:var(--ink)]">中央审计中心</h1>
        <p className="max-w-3xl text-sm text-[color:var(--ink-soft)]">统一查看业务、模型运行与模板事件。查询始终限定组织和时间，敏感输入、输出、凭据与内部重试信息不会展示。</p>
      </header>

      <Card>
        <CardHeader><CardTitle>查询范围</CardTitle><CardDescription>时间范围最长 31 天；更多结果使用稳定游标继续读取。</CardDescription></CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm font-semibold">组织 ID<Input value={form.organizationId} onChange={(event) => update('organizationId')(event.target.value)} /></label>
            <label className="text-sm font-semibold">开始时间<Input type="datetime-local" value={form.from} onChange={(event) => update('from')(event.target.value)} /></label>
            <label className="text-sm font-semibold">结束时间<Input type="datetime-local" value={form.to} onChange={(event) => update('to')(event.target.value)} /></label>
            <label className="text-sm font-semibold">操作者<Input value={form.actorUserId} onChange={(event) => update('actorUserId')(event.target.value)} placeholder="User ID" /></label>
            <label className="text-sm font-semibold">资源类型<Input value={form.resourceType} onChange={(event) => update('resourceType')(event.target.value)} /></label>
            <label className="text-sm font-semibold">资源 ID<Input value={form.resourceId} onChange={(event) => update('resourceId')(event.target.value)} /></label>
            <label className="text-sm font-semibold">动作<Input value={form.action} onChange={(event) => update('action')(event.target.value)} /></label>
            <label className="text-sm font-semibold md:col-span-2">Request / Correlation ID<Input value={form.requestId} onChange={(event) => update('requestId')(event.target.value)} /></label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={!canSubmit} onClick={submit}><Filter size={16} />查询</Button>
            <Button disabled={!activeFilters || loading} onClick={() => void createExport()}>创建异步导出</Button>
          </div>
        </CardContent>
      </Card>

      {exportJob ? (
        <Card className="border-[color:var(--accent)]/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><strong>导出任务 {exportJob.id}</strong><p className="text-sm text-[color:var(--ink-soft)]">状态：{exportJob.status}{exportJob.failureCode ? ` · ${exportJob.failureCode}` : ''}</p></div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void refreshExport()}><RefreshCw size={14} />刷新</Button>
              <Button size="sm" variant="primary" disabled={exportJob.status !== 'completed'} onClick={() => void download()}><Download size={14} />短时授权下载</Button>
            </div>
          </div>
        </Card>
      ) : null}

      {error ? <div className="rounded-[var(--radius-sm)] border border-status-error-fg/30 bg-status-error-bg p-3 text-sm text-status-error-fg">{error}</div> : null}

      <section className="flex flex-col gap-3" aria-live="polite">
        {events.map((event) => <EventCard key={`${event.source}:${event.id}`} event={event} />)}
        {!loading && activeFilters && events.length === 0 ? <p className="py-10 text-center text-sm text-[color:var(--ink-soft)]">该范围内没有审计事件。</p> : null}
        {cursor && activeFilters ? <Button disabled={loading} onClick={() => void load(activeFilters, cursor, true)}>{loading ? '读取中…' : '加载更多'}</Button> : null}
      </section>
    </div>
  );
}