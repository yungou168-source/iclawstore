import { useCallback, useEffect, useState, type ButtonHTMLAttributes } from "react";
import {
  desktopTemplateAdminApi,
  DesktopTemplateAdminApiError,
  type PublisherTemplateVersionItem,
  type TemplateReviewDetail,
  type TemplateReviewQueueItem,
} from "../../lib/desktopTemplateAdminApi";
import { useLocale } from "../../lib/i18n/context";

export function TemplateReviewPage() {
  const { t } = useLocale();
  const [items, setItems] = useState<TemplateReviewQueueItem[]>([]);
  const [publisherItems, setPublisherItems] = useState<PublisherTemplateVersionItem[]>([]);
  const [view, setView] = useState<"publisher" | "review">("review");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TemplateReviewDetail | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadQueue = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const response = await desktopTemplateAdminApi.listQueue(cursor);
        setItems((current) => (cursor ? [...current, ...response.items] : response.items));
        setNextCursor(response.nextCursor);
      } catch (caught) {
        setError(errorMessage(caught, t("ai_direct.template.request_failed")));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  const loadPublisherItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await desktopTemplateAdminApi.listPublisherTemplates();
      setPublisherItems(response.items);
    } catch (caught) {
      setError(errorMessage(caught, t("ai_direct.template.request_failed")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadDetail = useCallback(
    async (versionId: string) => {
      setSelectedId(versionId);
      setDetailLoading(true);
      setError(null);
      setNotice(null);
      try {
        setDetail(await desktopTemplateAdminApi.getDetail(versionId));
      } catch (caught) {
        setDetail(null);
        setError(errorMessage(caught, t("ai_direct.template.request_failed")));
      } finally {
        setDetailLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const resubmit = async (item: PublisherTemplateVersionItem) => {
    if (!item.versionId) return;
    setWorking(true);
    setError(null);
    try {
      await desktopTemplateAdminApi.resubmit(item.id, item.versionId);
      setNotice(
        t("ai_direct.template.resubmitted", {
          name: item.name,
          version: item.version ?? "—",
        }),
      );
      await loadPublisherItems();
    } catch (caught) {
      setError(errorMessage(caught, t("ai_direct.template.request_failed")));
    } finally {
      setWorking(false);
    }
  };

  const act = async (action: "approve" | "reject" | "publish" | "unpublish") => {
    if (!selectedId) return;
    if (action === "reject" && !reason.trim()) {
      setError(t("ai_direct.template.reject_reason_required"));
      return;
    }
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      if (action === "approve") await desktopTemplateAdminApi.approve(selectedId, reason);
      if (action === "reject") await desktopTemplateAdminApi.reject(selectedId, reason.trim());
      if (action === "publish") await desktopTemplateAdminApi.publish(selectedId);
      if (action === "unpublish") await desktopTemplateAdminApi.unpublish(selectedId);
      setNotice(t(actionLabel(action)));
      setReason("");
      await Promise.all([loadQueue(), loadDetail(selectedId)]);
    } catch (caught) {
      setError(errorMessage(caught, t("ai_direct.template.request_failed")));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8">
      <header className="mb-6">
        <p className="text-sm font-medium text-muted-foreground">
          {t("ai_direct.template.publisher_eyebrow")}
        </p>
        <h1 className="text-2xl font-semibold">{t("ai_direct.template.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("ai_direct.template.subtitle")}</p>
      </header>

      <div
        className="mb-6 flex gap-2"
        role="tablist"
        aria-label={t("ai_direct.template.tabs_label")}
      >
        <button
          type="button"
          role="tab"
          aria-selected={view === "review"}
          className="rounded-md border px-3 py-2 text-sm"
          onClick={() => {
            setView("review");
            void loadQueue();
          }}
        >
          {t("ai_direct.template.review_tab")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "publisher"}
          className="rounded-md border px-3 py-2 text-sm"
          onClick={() => {
            setView("publisher");
            void loadPublisherItems();
          }}
        >
          {t("ai_direct.template.publisher_tab")}
        </button>
      </div>

      {error ? (
        <div
          role="alert"
          className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}{" "}
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => void (view === "review" ? loadQueue() : loadPublisherItems())}
          >
            {t("ai_direct.template.retry")}
          </button>
        </div>
      ) : null}
      {notice ? (
        <div role="status" className="mb-4 rounded-md border p-3 text-sm">
          {notice}
        </div>
      ) : null}

      {view === "publisher" ? (
        <section
          className="rounded-lg border bg-card"
          aria-label={t("ai_direct.template.publisher_section")}
        >
          <div className="border-b p-4">
            <h2 className="font-semibold">{t("ai_direct.template.publisher_versions")}</h2>
            <p className="text-xs text-muted-foreground">
              {t("ai_direct.template.publisher_versions_description")}
            </p>
          </div>
          {loading && publisherItems.length === 0 ? (
            <p className="p-4 text-sm">{t("ai_direct.template.loading")}</p>
          ) : null}
          {!loading && publisherItems.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              {t("ai_direct.template.empty_publisher_versions")}
            </p>
          ) : null}
          <ul className="divide-y">
            {publisherItems.map((item) => (
              <li
                key={`${item.id}:${item.versionId ?? "none"}`}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div>
                  <strong>
                    {item.name}
                    {item.version ? ` · v${item.version}` : ""}
                  </strong>
                  <div className="flex gap-2">
                    <Status value={item.reviewStatus ?? "draft"} />
                    <Status value={item.publicationStatus ?? item.catalogStatus} />
                  </div>
                  {item.latestReviewReason ? (
                    <p className="mt-2 text-sm text-destructive">
                      {t("ai_direct.template.reject_reason", { reason: item.latestReviewReason })}
                    </p>
                  ) : null}
                </div>
                {item.reviewStatus === "rejected" && item.versionId ? (
                  <ActionButton disabled={working} onClick={() => void resubmit(item)}>
                    {t("ai_direct.template.resubmit")}
                  </ActionButton>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.5fr)]">
          <section
            className="rounded-lg border bg-card"
            aria-label={t("ai_direct.template.queue_section")}
          >
            <div className="border-b p-4">
              <h2 className="font-semibold">{t("ai_direct.template.queue_section")}</h2>
              <p className="text-xs text-muted-foreground">
                {t("ai_direct.template.queue_description")}
              </p>
            </div>
            {loading && items.length === 0 ? (
              <p className="p-4 text-sm">{t("ai_direct.template.loading")}</p>
            ) : null}
            {!loading && items.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                {t("ai_direct.template.empty_queue")}
              </p>
            ) : null}
            <ul className="divide-y">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`w-full p-4 text-left hover:bg-muted/50 ${selectedId === item.id ? "bg-muted" : ""}`}
                    onClick={() => void loadDetail(item.id)}
                  >
                    <span className="block font-medium">{item.templateName}</span>
                    <span className="block text-sm text-muted-foreground">
                      {item.publisherName} · v{item.version}
                    </span>
                    <Status value={item.reviewStatus} />
                  </button>
                </li>
              ))}
            </ul>
            {nextCursor ? (
              <button
                type="button"
                disabled={loading}
                className="m-4 rounded-md border px-3 py-2 text-sm"
                onClick={() => void loadQueue(nextCursor)}
              >
                {loading ? t("ai_direct.template.loading") : t("ai_direct.template.load_more")}
              </button>
            ) : null}
          </section>

          <section
            className="rounded-lg border bg-card"
            aria-label={t("ai_direct.template.detail_section")}
          >
            {!selectedId ? (
              <p className="p-6 text-sm text-muted-foreground">
                {t("ai_direct.template.select_version")}
              </p>
            ) : null}
            {detailLoading ? (
              <p className="p-6 text-sm">{t("ai_direct.template.loading_detail")}</p>
            ) : null}
            {detail && !detailLoading ? (
              <div className="space-y-5 p-6">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold">
                      {detail.templateName} · v{detail.version}
                    </h2>
                    <Status value={detail.reviewStatus} />
                    <Status value={detail.publicationStatus} />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {detail.publisherName} / {detail.templateSlug}
                  </p>
                  <p className="mt-3 text-sm">{detail.description}</p>
                </div>

                <dl className="grid gap-3 rounded-md border p-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">{t("ai_direct.template.package_sha")}</dt>
                    <dd className="break-all font-mono text-xs">{detail.sha256}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">
                      {t("ai_direct.template.package_size")}
                    </dt>
                    <dd>{t("ai_direct.template.bytes", { count: detail.sizeBytes })}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t("ai_direct.template.screenshots")}</dt>
                    <dd>
                      {t("ai_direct.template.screenshots_count", {
                        count: detail.screenshots.length,
                      })}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">
                      {t("ai_direct.template.publication_status")}
                    </dt>
                    <dd>{detail.publicationStatus}</dd>
                  </div>
                </dl>

                <details className="rounded-md border p-4">
                  <summary className="cursor-pointer font-medium">
                    {t("ai_direct.template.manifest_summary")}
                  </summary>
                  <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-xs">
                    {typeof detail.manifest === "string"
                      ? detail.manifest
                      : JSON.stringify(detail.manifest, null, 2)}
                  </pre>
                </details>

                <div>
                  <h3 className="mb-2 font-medium">{t("ai_direct.template.history")}</h3>
                  {detail.decisions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t("ai_direct.template.empty_history")}
                    </p>
                  ) : (
                    <ul className="space-y-2 text-sm">
                      {detail.decisions.map((decision) => (
                        <li key={decision.id} className="rounded-md border p-3">
                          <Status value={decision.decision} />
                          <span className="ml-2">
                            {decision.reason || t("ai_direct.template.no_note")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <label className="block text-sm font-medium">
                  {t("ai_direct.template.reason_label")}
                  <textarea
                    rows={4}
                    maxLength={2000}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder={t("ai_direct.template.reason_placeholder")}
                    className="mt-2 w-full rounded-md border bg-background p-3 font-normal"
                  />
                </label>

                <div className="flex flex-wrap gap-2">
                  <ActionButton
                    disabled={working || detail.reviewStatus !== "pending_review"}
                    onClick={() => void act("approve")}
                  >
                    {t("ai_direct.template.approve")}
                  </ActionButton>
                  <ActionButton
                    disabled={working || detail.reviewStatus !== "pending_review" || !reason.trim()}
                    onClick={() => void act("reject")}
                  >
                    {t("ai_direct.template.reject")}
                  </ActionButton>
                  <ActionButton
                    disabled={
                      working ||
                      detail.reviewStatus !== "approved" ||
                      detail.publicationStatus === "published"
                    }
                    onClick={() => void act("publish")}
                  >
                    {t("ai_direct.template.publish")}
                  </ActionButton>
                  <ActionButton
                    disabled={working || detail.publicationStatus !== "published"}
                    onClick={() => void act("unpublish")}
                  >
                    {t("ai_direct.template.unpublish")}
                  </ActionButton>
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
  return (
    <button
      type="button"
      {...props}
      className="rounded-md border px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
    />
  );
}

function actionLabel(action: "approve" | "reject" | "publish" | "unpublish") {
  const labels = {
    approve: "ai_direct.template.action_approved",
    reject: "ai_direct.template.action_rejected",
    publish: "ai_direct.template.action_published",
    unpublish: "ai_direct.template.action_unpublished",
  } as const;
  return labels[action];
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof DesktopTemplateAdminApiError)
    return `${error.message}${error.code ? ` (${error.code})` : ""}`;
  return error instanceof Error ? error.message : fallback;
}
