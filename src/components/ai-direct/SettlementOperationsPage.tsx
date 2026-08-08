import { useCallback, useEffect, useMemo, useState } from "react";
import {
  aiDirectPaidHiringApi as api,
  formatCnyFen,
  PaidHiringApiError,
  type DeveloperSettlementDetailDto,
  type DeveloperSettlementDto,
  type OperationalAlertDto,
  type SettleableLedgerEntryDto,
} from "../../lib/aiDirectPaidHiringApi";
import { useLocale } from "../../lib/i18n/context";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

type SettlementOperationsPageProps = {
  onStaffAccessChange: (allowed: boolean) => void;
};

const errorMessage = (error: unknown, fallback: () => string): string =>
  error instanceof Error ? error.message : fallback();

const dateTime = (value: string, locale: string): string => new Date(value).toLocaleString(locale);

export function SettlementOperationsPage({ onStaffAccessChange }: SettlementOperationsPageProps) {
  const { locale, t } = useLocale();
  const [balances, setBalances] = useState<Array<{ developerUserId: string; payableFen: string }>>(
    [],
  );
  const [entries, setEntries] = useState<SettleableLedgerEntryDto[]>([]);
  const [settlements, setSettlements] = useState<DeveloperSettlementDto[]>([]);
  const [alerts, setAlerts] = useState<OperationalAlertDto[]>([]);
  const [selectedDeveloperId, setSelectedDeveloperId] = useState("");
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  const [selectedSettlementId, setSelectedSettlementId] = useState("");
  const [detail, setDetail] = useState<DeveloperSettlementDetailDto | null>(null);
  const [failureReason, setFailureReason] = useState("");
  const [externalReference, setExternalReference] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [balancePage, settlementPage, alertPage] = await Promise.all([
        api.listPayableBalances({ limit: 50 }),
        api.listSettlements({ limit: 50 }),
        api.listOperationalAlerts({ status: "open", limit: 20 }),
      ]);
      onStaffAccessChange(true);
      setBalances(balancePage.items);
      setSettlements(settlementPage.items);
      setAlerts(alertPage.items);
      setSelectedDeveloperId((current) =>
        balancePage.items.some((item) => item.developerUserId === current)
          ? current
          : (balancePage.items[0]?.developerUserId ?? ""),
      );
      setError(null);
    } catch (caught) {
      if (caught instanceof PaidHiringApiError && caught.isForbidden) onStaffAccessChange(false);
      else setError(errorMessage(caught, () => t("ai_direct.common.not_completed")));
    } finally {
      setLoading(false);
    }
  }, [onStaffAccessChange]);

  const loadEntries = useCallback(async () => {
    if (!selectedDeveloperId) {
      setEntries([]);
      return;
    }
    try {
      const page = await api.listSettleableEntries(selectedDeveloperId, { limit: 100 });
      setEntries(page.items);
      setSelectedEntryIds([]);
    } catch (caught) {
      setError(errorMessage(caught, () => t("ai_direct.common.not_completed")));
    }
  }, [selectedDeveloperId]);

  const loadDetail = useCallback(async (settlementId: string) => {
    setSelectedSettlementId(settlementId);
    try {
      const next = await api.getSettlement(settlementId);
      setDetail(next);
      setFailureReason(next.failureReason ?? "");
      setExternalReference(next.externalReference ?? "");
    } catch (caught) {
      setDetail(null);
      setError(errorMessage(caught, () => t("ai_direct.common.not_completed")));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const selectedTotal = useMemo(
    () =>
      entries
        .filter((entry) => selectedEntryIds.includes(entry.id))
        .reduce((sum, entry) => sum + BigInt(entry.amountFen), 0n)
        .toString(),
    [entries, selectedEntryIds],
  );

  const run = async (action: () => Promise<unknown>, success: string, reloadDetail = false) => {
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await Promise.all([refresh(), loadEntries()]);
      if (reloadDetail && selectedSettlementId) await loadDetail(selectedSettlementId);
      setNotice(success);
    } catch (caught) {
      setError(errorMessage(caught, () => t("ai_direct.common.not_completed")));
    } finally {
      setWorking(false);
    }
  };

  const createBatch = async () => {
    if (!selectedDeveloperId || selectedEntryIds.length === 0) return;
    await run(async () => {
      const created = await api.createSettlement({
        developerUserId: selectedDeveloperId,
        ledgerEntryIds: selectedEntryIds,
      });
      await loadDetail(created.id);
    }, t("ai_direct.settlement.created"));
  };

  if (loading && balances.length === 0)
    return (
      <div className="section">
        <p>{t("ai_direct.settlement.access_check")}</p>
      </div>
    );

  return (
    <div className="section flex flex-col gap-5">
      <div className="section-header">
        <div>
          <h1 className="section-title">{t("ai_direct.settlement.title")}</h1>
          <p className="section-subtitle">{t("ai_direct.settlement.subtitle")}</p>
        </div>
        <Button variant="outline" disabled={loading || working} onClick={() => void refresh()}>
          {t("ai_direct.common.refresh")}
        </Button>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-status-error-fg/20 bg-status-error-bg p-3 text-sm text-status-error-fg"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-md border p-3 text-sm">
          {notice}
        </p>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{t("ai_direct.settlement.balance")}</CardTitle>
            <CardDescription>{t("ai_direct.settlement.balance_desc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {balances.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("ai_direct.settlement.empty_balance")}
              </p>
            ) : (
              balances.map((balance) => (
                <button
                  key={balance.developerUserId}
                  type="button"
                  className={`flex w-full items-center justify-between rounded-md border p-3 text-left text-sm ${balance.developerUserId === selectedDeveloperId ? "bg-muted" : ""}`}
                  onClick={() => setSelectedDeveloperId(balance.developerUserId)}
                >
                  <span className="truncate font-mono text-xs">{balance.developerUserId}</span>
                  <strong>{formatCnyFen(balance.payableFen, locale)}</strong>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>可结算分录</CardTitle>
            <CardDescription>{t("ai_direct.settlement.entries_desc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!selectedDeveloperId ? (
              <p className="text-sm text-muted-foreground">
                {t("ai_direct.settlement.select_developer")}
              </p>
            ) : null}
            {entries.map((entry) => {
              const checked = selectedEntryIds.includes(entry.id);
              return (
                <label
                  key={entry.id}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-md border p-3 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSelectedEntryIds((current) =>
                          checked
                            ? current.filter((id) => id !== entry.id)
                            : [...current, entry.id],
                        )
                      }
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-xs">
                        {entry.paymentOrderId}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {dateTime(entry.createdAt, locale)}
                      </span>
                    </span>
                  </span>
                  <strong>{formatCnyFen(entry.amountFen, locale)}</strong>
                </label>
              );
            })}
            {selectedDeveloperId && entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("ai_direct.settlement.empty_entries")}
              </p>
            ) : null}
            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <span className="text-sm">
                {t("ai_direct.settlement.selected_entries", { count: selectedEntryIds.length })}
              </span>
              <Button
                disabled={working || selectedEntryIds.length === 0}
                onClick={() => void createBatch()}
              >
                {t("ai_direct.settlement.create_batch", {
                  amount: formatCnyFen(selectedTotal, locale),
                })}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>结算批次</CardTitle>
            <CardDescription>{t("ai_direct.settlement.batches_desc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {settlements.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("ai_direct.settlement.empty_batches")}
              </p>
            ) : (
              settlements.map((settlement) => (
                <button
                  key={settlement.id}
                  type="button"
                  className={`flex w-full items-center justify-between gap-3 rounded-md border p-3 text-left ${settlement.id === selectedSettlementId ? "bg-muted" : ""}`}
                  onClick={() => void loadDetail(settlement.id)}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-xs">
                      {settlement.developerUserId}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {settlement.createdAt
                        ? dateTime(settlement.createdAt, locale)
                        : settlement.id}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge>{settlement.status}</Badge>
                    <strong className="text-sm">
                      {formatCnyFen(settlement.amountFen, locale)}
                    </strong>
                  </span>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("ai_direct.settlement.detail")}</CardTitle>
            <CardDescription>{t("ai_direct.settlement.detail_desc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!detail ? (
              <p className="text-sm text-muted-foreground">
                {t("ai_direct.settlement.select_batch")}
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{detail.status}</Badge>
                  <strong>{formatCnyFen(detail.amountFen, locale)}</strong>
                  <span className="font-mono text-xs text-muted-foreground">
                    {detail.developerUserId}
                  </span>
                </div>
                <p className="text-sm">
                  {t("ai_direct.settlement.entries_count", { count: detail.items.length })}
                </p>
                {detail.failureReason ? (
                  <p className="rounded-md border p-3 text-sm">
                    {t("ai_direct.settlement.failure_reason", { reason: detail.failureReason })}
                  </p>
                ) : null}
                {detail.externalReference ? (
                  <p className="rounded-md border p-3 text-sm">
                    {t("ai_direct.settlement.external_reference", {
                      reference: detail.externalReference,
                    })}
                  </p>
                ) : null}
                {detail.status === "pending" ? (
                  <Button
                    disabled={working}
                    onClick={() =>
                      void run(
                        () => api.transitionSettlement(detail.id, "processing"),
                        t("ai_direct.settlement.processing"),
                        true,
                      )
                    }
                  >
                    {t("ai_direct.settlement.start")}
                  </Button>
                ) : null}
                {detail.status === "failed" ? (
                  <Button
                    disabled={working}
                    onClick={() =>
                      void run(
                        () => api.transitionSettlement(detail.id, "retry"),
                        t("ai_direct.settlement.retrying"),
                        true,
                      )
                    }
                  >
                    {t("ai_direct.settlement.retry")}
                  </Button>
                ) : null}
                {detail.status === "processing" ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="settlement-failure">
                        {t("ai_direct.settlement.failure_reason_label")}
                      </Label>
                      <Input
                        id="settlement-failure"
                        value={failureReason}
                        maxLength={512}
                        onChange={(event) => setFailureReason(event.target.value)}
                      />
                      <Button
                        variant="destructive"
                        disabled={working || !failureReason.trim()}
                        onClick={() =>
                          void run(
                            () => api.transitionSettlement(detail.id, "failed", { failureReason }),
                            t("ai_direct.settlement.failed"),
                            true,
                          )
                        }
                      >
                        {t("ai_direct.settlement.mark_failed")}
                      </Button>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="settlement-reference">
                        {t("ai_direct.settlement.external_reference_label")}
                      </Label>
                      <Input
                        id="settlement-reference"
                        value={externalReference}
                        maxLength={191}
                        onChange={(event) => setExternalReference(event.target.value)}
                      />
                      <Button
                        disabled={working || !externalReference.trim()}
                        onClick={() =>
                          void run(
                            () =>
                              api.transitionSettlement(detail.id, "completed", {
                                externalReference,
                              }),
                            t("ai_direct.settlement.completed"),
                            true,
                          )
                        }
                      >
                        {t("ai_direct.settlement.complete")}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("ai_direct.settlement.alerts")}</CardTitle>
          <CardDescription>{t("ai_direct.settlement.alerts_desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("ai_direct.settlement.empty_alerts")}
            </p>
          ) : (
            alerts.map((alert) => (
              <div
                key={alert.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm"
              >
                <span>
                  <Badge>{alert.severity}</Badge>
                  <span className="ml-2">{alert.code}</span>
                </span>
                <span>
                  {t("ai_direct.settlement.occurrences", {
                    count: alert.occurrenceCount,
                    time: dateTime(alert.lastObservedAt, locale),
                  })}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
