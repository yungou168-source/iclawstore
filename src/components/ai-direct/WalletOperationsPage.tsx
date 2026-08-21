import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  type AdminWalletAccount,
  formatWalletCny,
  type RechargeOrder,
  type WalletRefund,
  type WalletStatementItem,
  type Withdrawal,
  walletApi,
} from "../../lib/aiDirectWalletApi";
import { useLocale } from "../../lib/i18n/context";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

type View = "accounts" | "recharges" | "refunds" | "withdrawals";
type ConfirmRequest = { description: string; run: () => Promise<unknown> };

const statusOptions: Record<View, string[]> = {
  accounts: [],
  recharges: ["pending", "paid", "closed"],
  refunds: ["pending", "completed", "rejected"],
  withdrawals: ["pending", "processing", "failed", "completed"],
};

const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export function WalletOperationsPage() {
  const { locale, t } = useLocale();
  const [view, setView] = useState<View>("accounts");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [accounts, setAccounts] = useState<AdminWalletAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<AdminWalletAccount | null>(null);
  const [statement, setStatement] = useState<WalletStatementItem[]>([]);
  const [recharges, setRecharges] = useState<RechargeOrder[]>([]);
  const [refunds, setRefunds] = useState<WalletRefund[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [paymentOrderId, setPaymentOrderId] = useState("");
  const [refundAmountFen, setRefundAmountFen] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [externalReference, setExternalReference] = useState("");
  const [failureReason, setFailureReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      if (view === "accounts") {
        const page = await walletApi.listAdminAccounts(search.trim());
        setAccounts(page.items);
        setSelectedAccount(
          (current) => page.items.find((item) => item.userId === current?.userId) ?? null,
        );
      } else if (view === "recharges") {
        setRecharges((await walletApi.listAdminRecharges(status)).items);
      } else if (view === "refunds") {
        setRefunds((await walletApi.listAdminRefunds(status)).items);
      } else {
        setWithdrawals((await walletApi.listAdminWithdrawals(status)).items);
      }
    } catch (error) {
      toast.error(messageOf(error, t("wallet.admin.load_failed")));
    } finally {
      setLoading(false);
    }
  }, [search, status, t, view]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectAccount = async (account: AdminWalletAccount) => {
    setSelectedAccount(account);
    setLoading(true);
    try {
      setStatement((await walletApi.listAdminStatement(account.userId)).items);
    } catch (error) {
      toast.error(messageOf(error, t("wallet.admin.load_failed")));
    } finally {
      setLoading(false);
    }
  };

  const queue = (description: string, run: () => Promise<unknown>) =>
    setConfirmRequest({ description, run });

  const executeConfirmed = async () => {
    if (!confirmRequest) return;
    setLoading(true);
    try {
      await confirmRequest.run();
      setConfirmRequest(null);
      toast.success(t("wallet.admin.operation_completed"));
      await refresh();
    } catch (error) {
      toast.error(messageOf(error, t("ai_direct.common.not_completed")));
    } finally {
      setLoading(false);
    }
  };

  const queueRefundCreation = () => {
    if (!paymentOrderId.trim() || !/^[1-9]\d*$/.test(refundAmountFen) || !refundReason.trim()) {
      toast.error(t("wallet.admin.required_fields"));
      return;
    }
    queue(`${paymentOrderId} · ${formatWalletCny(refundAmountFen, locale)} · ${refundReason}`, () =>
      walletApi.createRefund({
        paymentOrderId: paymentOrderId.trim(),
        amountFen: refundAmountFen,
        reason: refundReason.trim(),
      }),
    );
  };

  const changeView = (next: View) => {
    setView(next);
    setStatus("");
  };

  return (
    <div className="section flex flex-col gap-5">
      <header className="section-header">
        <div>
          <h1 className="section-title">{t("wallet.admin.title")}</h1>
          <p className="section-subtitle">{t("wallet.admin.subtitle")}</p>
        </div>
        <Button variant="outline" disabled={loading} onClick={() => void refresh()}>
          {t("wallet.admin.refresh")}
        </Button>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label={t("wallet.admin.title")}>
        {(
          [
            ["accounts", t("wallet.admin.accounts")],
            ["recharges", t("wallet.admin.recharges")],
            ["refunds", t("wallet.admin.refunds")],
            ["withdrawals", t("wallet.admin.withdrawals")],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            variant={view === key ? "default" : "outline"}
            onClick={() => changeView(key)}
          >
            {label}
          </Button>
        ))}
      </nav>

      {view === "accounts" ? (
        <AccountsView
          accounts={accounts}
          locale={locale}
          search={search}
          selectedAccount={selectedAccount}
          statement={statement}
          onSearch={setSearch}
          onSelect={(account) => void selectAccount(account)}
        />
      ) : (
        <div className="flex max-w-xs items-center gap-2">
          <Label className="sr-only" htmlFor="wallet-status-filter">
            {t("wallet.admin.status")}
          </Label>
          <select
            id="wallet-status-filter"
            className="min-h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">{t("wallet.admin.status_all")}</option>
            {statusOptions[view].map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
      )}

      {view === "recharges" ? <RechargeView items={recharges} locale={locale} /> : null}
      {view === "refunds" ? (
        <RefundView
          items={refunds}
          locale={locale}
          paymentOrderId={paymentOrderId}
          amountFen={refundAmountFen}
          reason={refundReason}
          reviewNote={reviewNote}
          onPaymentOrderId={setPaymentOrderId}
          onAmountFen={setRefundAmountFen}
          onReason={setRefundReason}
          onReviewNote={setReviewNote}
          onCreate={queueRefundCreation}
          onReview={(item, action) =>
            queue(`${action} · ${item.id} · ${reviewNote || "-"}`, () =>
              walletApi.reviewRefund(item.id, action, reviewNote.trim()),
            )
          }
        />
      ) : null}
      {view === "withdrawals" ? (
        <WithdrawalView
          items={withdrawals}
          locale={locale}
          externalReference={externalReference}
          failureReason={failureReason}
          onExternalReference={setExternalReference}
          onFailureReason={setFailureReason}
          onTransition={(item, action) => {
            if (action === "completed" && !externalReference.trim()) {
              toast.error(t("wallet.admin.required_fields"));
              return;
            }
            if (action === "failed" && !failureReason.trim()) {
              toast.error(t("wallet.admin.required_fields"));
              return;
            }
            queue(`${action} · ${item.id}`, () =>
              walletApi.transitionWithdrawal(item.id, action, {
                externalReference: externalReference.trim() || undefined,
                failureReason: failureReason.trim() || undefined,
              }),
            );
          }}
        />
      ) : null}

      <Dialog
        open={confirmRequest !== null}
        onOpenChange={(open) => !open && setConfirmRequest(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("wallet.admin.confirm_action")}</DialogTitle>
            <DialogDescription>{t("wallet.admin.confirm_description")}</DialogDescription>
          </DialogHeader>
          <p className="break-all rounded-md border bg-muted/40 p-3 text-sm">
            {confirmRequest?.description}
          </p>
          <DialogFooter>
            <Button variant="outline" disabled={loading} onClick={() => setConfirmRequest(null)}>
              {t("wallet.admin.cancel")}
            </Button>
            <Button disabled={loading} onClick={() => void executeConfirmed()}>
              {t("wallet.admin.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AccountsView({
  accounts,
  locale,
  search,
  selectedAccount,
  statement,
  onSearch,
  onSelect,
}: {
  accounts: AdminWalletAccount[];
  locale: string;
  search: string;
  selectedAccount: AdminWalletAccount | null;
  statement: WalletStatementItem[];
  onSearch: (value: string) => void;
  onSelect: (account: AdminWalletAccount) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]">
      <Card>
        <CardHeader>
          <CardTitle>{t("wallet.admin.accounts")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={t("wallet.admin.search")}
          />
          {accounts.length === 0 ? (
            <Empty>{t("wallet.admin.no_accounts")}</Empty>
          ) : (
            accounts.map((account) => (
              <button
                key={account.userId}
                type="button"
                onClick={() => onSelect(account)}
                className={`w-full rounded-md border p-3 text-left text-sm ${selectedAccount?.userId === account.userId ? "bg-muted" : ""}`}
              >
                <strong>{account.handle ?? account.email ?? account.userId}</strong>
                <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">
                  {account.userId}
                </span>
                <span className="mt-2 flex justify-between gap-2">
                  <span>
                    {t("wallet.admin.available")} {formatWalletCny(account.availableFen, locale)}
                  </span>
                  <span>
                    {t("wallet.admin.frozen")} {formatWalletCny(account.frozenFen, locale)}
                  </span>
                </span>
              </button>
            ))
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("wallet.admin.statement")}</CardTitle>
          <CardDescription>{selectedAccount?.userId ?? t("wallet.admin.account")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {statement.length === 0 ? (
            <Empty>{t("wallet.admin.no_statement")}</Empty>
          ) : (
            statement.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm"
              >
                <span>
                  <strong>{item.entryType}</strong>
                  <span className="block font-mono text-xs text-muted-foreground">
                    {item.businessType} · {item.businessId}
                  </span>
                </span>
                <span className="text-right">
                  <strong>{formatSigned(item.availableDeltaFen, locale)}</strong>
                  <span className="block text-xs text-muted-foreground">
                    {new Date(item.createdAt).toLocaleString(locale)}
                  </span>
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RechargeView({ items, locale }: { items: RechargeOrder[]; locale: string }) {
  const { t } = useLocale();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("wallet.admin.recharges")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? (
          <Empty>{t("wallet.admin.no_recharges")}</Empty>
        ) : (
          items.map((item) => (
            <RecordRow
              key={item.id}
              title={item.outTradeNo}
              subtitle={`${item.providerTradeNo ?? "-"} · ${new Date(item.createdAt).toLocaleString(locale)}`}
              amount={formatWalletCny(item.amountFen, locale)}
              status={item.status}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function RefundView(props: {
  items: WalletRefund[];
  locale: string;
  paymentOrderId: string;
  amountFen: string;
  reason: string;
  reviewNote: string;
  onPaymentOrderId: (value: string) => void;
  onAmountFen: (value: string) => void;
  onReason: (value: string) => void;
  onReviewNote: (value: string) => void;
  onCreate: () => void;
  onReview: (item: WalletRefund, action: "approve" | "reject") => void;
}) {
  const { t } = useLocale();
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]">
      <Card>
        <CardHeader>
          <CardTitle>{t("wallet.admin.create_refund")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field
            label={t("wallet.admin.payment_order_id")}
            value={props.paymentOrderId}
            onChange={props.onPaymentOrderId}
          />
          <Field
            label={`${t("wallet.admin.amount")}（fen）`}
            value={props.amountFen}
            onChange={props.onAmountFen}
          />
          <Field
            label={t("wallet.admin.refund_reason")}
            value={props.reason}
            onChange={props.onReason}
          />
          <Button onClick={props.onCreate}>{t("wallet.admin.create_refund")}</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("wallet.admin.refunds")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field
            label={t("wallet.admin.review_reason")}
            value={props.reviewNote}
            onChange={props.onReviewNote}
          />
          {props.items.length === 0 ? (
            <Empty>{t("wallet.admin.no_refunds")}</Empty>
          ) : (
            props.items.map((item) => (
              <div key={item.id} className="rounded-md border p-3 text-sm">
                <RecordRow
                  title={item.paymentOrderId}
                  subtitle={`${item.userId} · ${item.reason}`}
                  amount={formatWalletCny(item.amountFen, props.locale)}
                  status={item.status}
                />
                {item.status === "pending" ? (
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" onClick={() => props.onReview(item, "approve")}>
                      {t("wallet.admin.approve")}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => props.onReview(item, "reject")}
                    >
                      {t("wallet.admin.reject")}
                    </Button>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function WithdrawalView(props: {
  items: Withdrawal[];
  locale: string;
  externalReference: string;
  failureReason: string;
  onExternalReference: (value: string) => void;
  onFailureReason: (value: string) => void;
  onTransition: (item: Withdrawal, action: "processing" | "completed" | "failed" | "retry") => void;
}) {
  const { t } = useLocale();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("wallet.admin.withdrawals")}</CardTitle>
        <CardDescription>{t("wallet.admin.confirm_description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Field
            label={t("wallet.admin.external_reference")}
            value={props.externalReference}
            onChange={props.onExternalReference}
          />
          <Field
            label={t("wallet.admin.review_reason")}
            value={props.failureReason}
            onChange={props.onFailureReason}
          />
        </div>
        {props.items.length === 0 ? (
          <Empty>{t("wallet.admin.no_withdrawals")}</Empty>
        ) : (
          props.items.map((item) => (
            <div key={item.id} className="rounded-md border p-3 text-sm">
              <RecordRow
                title={item.developerUserId}
                subtitle={`${item.id} · ${new Date(item.createdAt).toLocaleString(props.locale)}`}
                amount={formatWalletCny(item.amountFen, props.locale)}
                status={item.status}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {item.status === "pending" ? (
                  <Button size="sm" onClick={() => props.onTransition(item, "processing")}>
                    {t("wallet.admin.start_processing")}
                  </Button>
                ) : null}
                {item.status === "processing" ? (
                  <>
                    <Button size="sm" onClick={() => props.onTransition(item, "completed")}>
                      {t("wallet.admin.complete")}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => props.onTransition(item, "failed")}
                    >
                      {t("wallet.admin.mark_failed")}
                    </Button>
                  </>
                ) : null}
                {item.status === "failed" ? (
                  <Button size="sm" onClick={() => props.onTransition(item, "retry")}>
                    {t("wallet.admin.retry")}
                  </Button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span>{label}</span>
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function RecordRow({
  title,
  subtitle,
  amount,
  status,
}: {
  title: string;
  subtitle: string;
  amount: string;
  status: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="min-w-0">
        <strong className="block break-all">{title}</strong>
        <span className="block break-all text-xs text-muted-foreground">{subtitle}</span>
      </span>
      <span className="flex items-center gap-2">
        <Badge>{status}</Badge>
        <strong>{amount}</strong>
      </span>
    </div>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="py-5 text-center text-sm text-muted-foreground">{children}</p>;
}

const formatSigned = (amountFen: string, locale: string) =>
  `${BigInt(amountFen) > 0n ? "+" : ""}${formatWalletCny(amountFen, locale)}`;
