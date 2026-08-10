import { useCallback, useEffect, useState } from "react";
import {
  aiDirectManagementInsightsApi as api,
  type CostEntry,
  type Employee,
  type Overview,
  type SystemStatus,
} from "../../lib/aiDirectManagementInsightsApi";
import { useLocale } from "../../lib/i18n/context";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";

type View = "overview" | "system" | "employees" | "costs";

const insightViewKeys = {
  overview: "ai_direct.insights.view.overview",
  system: "ai_direct.insights.view.system",
  employees: "ai_direct.insights.view.employees",
  costs: "ai_direct.insights.view.costs",
} as const;

const formatMicros = (value: string, locale: string) =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(Number(value) / 1_000_000);
const formatDate = (value: string | null, locale: string) =>
  value ? new Date(value).toLocaleString(locale) : "—";

function Scope({
  organizationId,
  onChange,
}: {
  organizationId: string;
  onChange: (value: string) => void;
}) {
  const { t } = useLocale();

  return (
    <label className="text-sm font-medium">
      {t("ai_direct.insights.organization_id")}
      <Input
        value={organizationId}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("ai_direct.insights.organization_id")}
      />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle>{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

export function ManagementInsightsPage({ view }: { view: View }) {
  const { locale, t } = useLocale();
  const [organizationId, setOrganizationId] = useState("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [costs, setCosts] = useState<CostEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (cursor?: string) => {
      if (!organizationId.trim()) {
        setError(t("ai_direct.insights.required_organization"));
        return;
      }
      setLoading(true);
      setError(null);
      try {
        if (view === "overview") setOverview(await api.overview(organizationId.trim()));
        if (view === "system") setSystem(await api.systemStatus(organizationId.trim()));
        if (view === "employees") {
          const page = await api.employees(organizationId.trim(), cursor);
          setEmployees((current) => (cursor ? [...current, ...page.items] : page.items));
          setNextCursor(page.nextCursor);
        }
        if (view === "costs") {
          const page = await api.costs(organizationId.trim(), cursor);
          setCosts((current) => (cursor ? [...current, ...page.items] : page.items));
          setNextCursor(page.nextCursor);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t("ai_direct.insights.load_failed"));
      } finally {
        setLoading(false);
      }
    },
    [organizationId, t, view],
  );

  useEffect(() => {
    setOverview(null);
    setSystem(null);
    setEmployees([]);
    setCosts([]);
    setNextCursor(null);
  }, [view, organizationId]);

  return (
    <div className="section flex flex-col gap-5">
      <header className="section-header">
        <div>
          <h1 className="section-title">{t(insightViewKeys[view])}</h1>
          <p className="section-subtitle">{t("ai_direct.insights.subtitle")}</p>
        </div>
      </header>
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Scope organizationId={organizationId} onChange={setOrganizationId} />
          <Button loading={loading} onClick={() => void load()}>
            {loading ? t("common.loading") : t("ai_direct.insights.query")}
          </Button>
        </CardContent>
      </Card>
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-status-error-fg/20 bg-status-error-bg p-3 text-sm text-status-error-fg"
        >
          {error}
        </p>
      ) : null}
      {overview ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Metric
            label={t("ai_direct.insights.active_employees")}
            value={overview.employees.active}
          />
          <Metric
            label={t("ai_direct.insights.pending_approvals")}
            value={overview.approvals.pending}
          />
          <Metric
            label={t("ai_direct.insights.running_queued")}
            value={`${overview.runs.active} / ${overview.runs.queued}`}
          />
          <Metric
            label={t("ai_direct.insights.costs_30d")}
            value={formatMicros(overview.costs.micros, locale)}
          />
        </div>
      ) : null}
      {system ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-4">
            <Metric label={t("ai_direct.insights.queued_runs")} value={system.runs.queued} />
            <Metric label={t("ai_direct.insights.active_runs")} value={system.runs.active} />
            <Metric label={t("ai_direct.insights.failed_runs")} value={system.runs.failed} />
            <Metric label={t("ai_direct.insights.expired_leases")} value={system.runs.expired} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>{t("ai_direct.insights.workers")}</CardTitle>
              <CardDescription>{t("ai_direct.insights.workers_description")}</CardDescription>
            </CardHeader>
            <CardContent>
              {system.workers.length ? (
                system.workers.map((worker) => (
                  <p key={worker.workerId}>
                    {t("ai_direct.insights.worker_summary", {
                      id: worker.workerId,
                      activeRuns: worker.activeRuns,
                      lastHeartbeat: formatDate(worker.lastHeartbeatAt, locale),
                    })}
                  </p>
                ))
              ) : (
                <p>{t("ai_direct.insights.empty_workers")}</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("ai_direct.insights.outbox")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p>
                {t("ai_direct.insights.outbox_summary", {
                  count: system.outbox.pending,
                  oldest: formatDate(system.outbox.oldestPendingAt, locale),
                })}
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}
      {view === "employees" && employees.length ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("ai_direct.insights.employee_directory")}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th>{t("ai_direct.insights.employee")}</th>
                  <th>{t("ai_direct.insights.company")}</th>
                  <th>{t("ai_direct.insights.role")}</th>
                  <th>{t("ai_direct.insights.status")}</th>
                  <th>{t("ai_direct.insights.started_at")}</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((item) => (
                  <tr key={item.id}>
                    <td>{item.agentName}</td>
                    <td>{item.companyName}</td>
                    <td>{item.roleName}</td>
                    <td>{item.status}</td>
                    <td>{formatDate(item.startedAt, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}
      {view === "costs" && costs.length ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("ai_direct.insights.model_costs")}</CardTitle>
            <CardDescription>{t("ai_direct.insights.model_costs_description")}</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th>{t("ai_direct.insights.time")}</th>
                  <th>{t("ai_direct.insights.model")}</th>
                  <th>{t("ai_direct.insights.tokens")}</th>
                  <th>{t("ai_direct.insights.cost")}</th>
                  <th>{t("ai_direct.insights.status")}</th>
                </tr>
              </thead>
              <tbody>
                {costs.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDate(item.createdAt, locale)}</td>
                    <td>{item.modelKey}</td>
                    <td>
                      {item.inputTokens ?? 0} / {item.outputTokens ?? 0}
                    </td>
                    <td>{formatMicros(item.costMicros, locale)}</td>
                    <td>{item.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}
      {nextCursor ? (
        <Button disabled={loading} onClick={() => void load(nextCursor)}>
          {t("ai_direct.insights.load_more")}
        </Button>
      ) : null}
    </div>
  );
}
