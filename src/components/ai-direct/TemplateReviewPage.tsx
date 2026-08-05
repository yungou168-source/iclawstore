import { useCallback, useEffect, useState, type ButtonHTMLAttributes } from 'react';
import {
  desktopTemplateAdminApi,
  DesktopTemplateAdminApiError,
  type PublisherTemplateVersionItem,
  type TemplateReviewDetail,
  type TemplateReviewQueueItem,
} from '../../lib/desktopTemplateAdminApi';

export function TemplateReviewPage() {
  const [items, setItems] = useState<TemplateReviewQueueItem[]>([]);
  const [publisherItems, setPublisherItems] = useState<PublisherTemplateVersionItem[]>([]);
  const [view, setView] = useState<'publisher' | 'review'>('review');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TemplateReviewDetail | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadQueue = useCallback(async (cursor?: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await desktopTemplateAdminApi.listQueue(cursor);
      setItems((current) => cursor ? [...current, ...response.items] : response.items);
      setNextCursor(response.nextCursor);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPublisherItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await desktopTemplateAdminApi.listPublisherTemplates();
      setPublisherItems(response.items);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (versionId: string) => {
    setSelectedId(versionId);
    setDetailLoading(true);
    setError(null);
    setNotice(null);
    try {
      setDetail(await desktopTemplateAdminApi.getDetail(versionId));
    } catch (caught) {
      setDetail(null);
      setError(errorMessage(caught));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const resubmit = async (item: PublisherTemplateVersionItem) => {
    if (!item.versionId) return;
    setWorking(true);
    setError(null);
    try {
      await desktopTemplateAdminApi.resubmit(item.id, item.versionId);
      setNotice(`${item.name} v${item.version} 已重新提交审核。`);
      await loadPublisherItems();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setWorking(false);
    }
  };

  const act = async (action: 'approve' | 'reject' | 'publish' | 'unpublish') => {
    if (!selectedId) return;
    if (action === 'reject' && !reason.trim()) {
      setError('拒绝时必须填写原因。');
      return;
    }
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      if (action === 'approve') await desktopTemplateAdminApi.approve(selectedId, reason);
      if (action === 'reject') await desktopTemplateAdminApi.reject(selectedId, reason.trim());
      if (action === 'publish') await desktopTemplateAdminApi.publish(selectedId);
      if (action === 'unpublish') await desktopTemplateAdminApi.unpublish(selectedId);
      setNotice(actionLabel(action));
      setReason('');
      await Promise.all([loadQueue(), loadDetail(selectedId)]);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8">
      <header className="mb-6">
        <p className="text-sm font-medium text-muted-foreground">Publisher 模板发布</p>
        <h1 className="text-2xl font-semibold">模板审核后台</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          审核包、manifest 与截图；审核通过后仍需单独发布，拒绝原因会保留给 Publisher 重新提交。
        </p>
      </header>

      <div className="mb-6 flex gap-2" role="tablist" aria-label="模板发布后台视图">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'review'}
          className="rounded-md border px-3 py-2 text-sm"
          onClick={() => { setView('review'); void loadQueue(); }}
        >管理员审核</button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'publisher'}
          className="rounded-md border px-3 py-2 text-sm"
          onClick={() => { setView('publisher'); void loadPublisherItems(); }}
        >我的 Publisher 版本</button>
      </div>

      {error ? (
        <div role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error} <button type="button" className="ml-2 underline" onClick={() => void (view === 'review' ? loadQueue() : loadPublisherItems())}>重试</button>
        </div>
      ) : null}
      {notice ? <div role="status" className="mb-4 rounded-md border p-3 text-sm">{notice}</div> : null}

      {view === 'publisher' ? (
        <section className="rounded-lg border bg-card" aria-label="Publisher 模板版本">
          <div className="border-b p-4">
            <h2 className="font-semibold">我的模板与版本</h2>
            <p className="text-xs text-muted-foreground">查看审核、发布状态与拒绝原因；被拒绝版本可重新提交。</p>
          </div>
          {loading && publisherItems.length === 0 ? <p className="p-4 text-sm">正在加载…</p> : null}
          {!loading && publisherItems.length === 0 ? <p className="p-4 text-sm text-muted-foreground">尚未创建模板版本。</p> : null}
          <ul className="divide-y">
            {publisherItems.map((item) => (
              <li key={`${item.id}:${item.versionId ?? 'none'}`} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <strong>{item.name}{item.version ? ` · v${item.version}` : ''}</strong>
                  <div className="flex gap-2"><Status value={item.reviewStatus ?? 'draft'} /><Status value={item.publicationStatus ?? item.catalogStatus} /></div>
                  {item.latestReviewReason ? <p className="mt-2 text-sm text-destructive">拒绝原因：{item.latestReviewReason}</p> : null}
                </div>
                {item.reviewStatus === 'rejected' && item.versionId ? (
                  <ActionButton disabled={working} onClick={() => void resubmit(item)}>重新提交</ActionButton>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : (
      <div className="grid gap-6 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.5fr)]">
        <section className="rounded-lg border bg-card" aria-label="待审队列">
          <div className="border-b p-4">
            <h2 className="font-semibold">待审队列</h2>
            <p className="text-xs text-muted-foreground">按提交时间倒序，使用游标继续加载</p>
          </div>
          {loading && items.length === 0 ? <p className="p-4 text-sm">正在加载…</p> : null}
          {!loading && items.length === 0 ? <p className="p-4 text-sm text-muted-foreground">当前没有待审核版本。</p> : null}
          <ul className="divide-y">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`w-full p-4 text-left hover:bg-muted/50 ${selectedId === item.id ? 'bg-muted' : ''}`}
                  onClick={() => void loadDetail(item.id)}
                >
                  <span className="block font-medium">{item.templateName}</span>
                  <span className="block text-sm text-muted-foreground">{item.publisherName} · v{item.version}</span>
                  <Status value={item.reviewStatus} />
                </button>
              </li>
            ))}
          </ul>
          {nextCursor ? (
            <button type="button" disabled={loading} className="m-4 rounded-md border px-3 py-2 text-sm" onClick={() => void loadQueue(nextCursor)}>
              {loading ? '加载中…' : '加载更多'}
            </button>
          ) : null}
        </section>

        <section className="rounded-lg border bg-card" aria-label="审核详情">
          {!selectedId ? <p className="p-6 text-sm text-muted-foreground">从左侧选择一个待审版本。</p> : null}
          {detailLoading ? <p className="p-6 text-sm">正在加载详情…</p> : null}
          {detail && !detailLoading ? (
            <div className="space-y-5 p-6">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold">{detail.templateName} · v{detail.version}</h2>
                  <Status value={detail.reviewStatus} />
                  <Status value={detail.publicationStatus} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{detail.publisherName} / {detail.templateSlug}</p>
                <p className="mt-3 text-sm">{detail.description}</p>
              </div>

              <dl className="grid gap-3 rounded-md border p-4 text-sm sm:grid-cols-2">
                <div><dt className="text-muted-foreground">包 SHA-256</dt><dd className="break-all font-mono text-xs">{detail.sha256}</dd></div>
                <div><dt className="text-muted-foreground">包大小</dt><dd>{String(detail.sizeBytes)} bytes</dd></div>
                <div><dt className="text-muted-foreground">截图</dt><dd>{detail.screenshots.length} 张</dd></div>
                <div><dt className="text-muted-foreground">发布状态</dt><dd>{detail.publicationStatus}</dd></div>
              </dl>

              <details className="rounded-md border p-4">
                <summary className="cursor-pointer font-medium">Manifest 与校验摘要</summary>
                <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-xs">
                  {typeof detail.manifest === 'string' ? detail.manifest : JSON.stringify(detail.manifest, null, 2)}
                </pre>
              </details>

              <div>
                <h3 className="mb-2 font-medium">审核历史</h3>
                {detail.decisions.length === 0 ? <p className="text-sm text-muted-foreground">暂无审核决定。</p> : (
                  <ul className="space-y-2 text-sm">
                    {detail.decisions.map((decision) => (
                      <li key={decision.id} className="rounded-md border p-3">
                        <Status value={decision.decision} />
                        <span className="ml-2">{decision.reason || '未填写备注'}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <label className="block text-sm font-medium">
                审核原因/备注
                <textarea
                  rows={4}
                  maxLength={2000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="拒绝时必填；批准时可选"
                  className="mt-2 w-full rounded-md border bg-background p-3 font-normal"
                />
              </label>

              <div className="flex flex-wrap gap-2">
                <ActionButton disabled={working || detail.reviewStatus !== 'pending_review'} onClick={() => void act('approve')}>批准</ActionButton>
                <ActionButton disabled={working || detail.reviewStatus !== 'pending_review' || !reason.trim()} onClick={() => void act('reject')}>拒绝</ActionButton>
                <ActionButton disabled={working || detail.reviewStatus !== 'approved' || detail.publicationStatus === 'published'} onClick={() => void act('publish')}>发布</ActionButton>
                <ActionButton disabled={working || detail.publicationStatus !== 'published'} onClick={() => void act('unpublish')}>下架</ActionButton>
              </div>
            </div>
          ) : null}
        </section>
      </div>
      )}
    </div>
  );
}

function Status({ value }: { value: string }) {
  return <span className="mt-2 inline-block rounded-full border px-2 py-0.5 text-xs">{value}</span>;
}

function ActionButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className="rounded-md border px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50" />;
}

function actionLabel(action: 'approve' | 'reject' | 'publish' | 'unpublish'): string {
  return ({ approve: '已批准；版本尚未发布。', reject: '已拒绝并记录原因。', publish: '版本已发布。', unpublish: '版本已下架。' })[action];
}

function errorMessage(error: unknown): string {
  if (error instanceof DesktopTemplateAdminApiError) return `${error.message}${error.code ? ` (${error.code})` : ''}`;
  return error instanceof Error ? error.message : '请求失败，请稍后重试。';
}