import { createFileRoute } from "@tanstack/react-router";
import { ArrowDownLeft, ArrowUpRight, CreditCard, RefreshCw, WalletCards } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { SignInPrompt } from "../components/SignInPrompt";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import {
  formatWalletCny,
  type EarningEntry,
  type WalletOverview,
  type WalletStatementItem,
  type Withdrawal,
  walletApi,
} from "../lib/aiDirectWalletApi";
import { useLocale } from "../lib/i18n/context";
import { useAuthStatus } from "../lib/useAuthStatus";

const rechargeStorageKey = "wallet-recharge-order-id";
const rechargePresets = [1000, 5000, 10_000, 50_000];

export const Route = createFileRoute("/wallet")({
  validateSearch: (search: Record<string, unknown>) => ({
    recharge: search.recharge === "return" ? ("return" as const) : undefined,
  }),
  component: WalletPage,
});

const signedMoney = (value: string, locale: string) => {
  const amount = BigInt(value);
  const sign = amount > 0n ? "+" : "";
  return `${sign}${formatWalletCny(value, locale)}`;
};

function WalletPage() {
  const { locale } = useLocale();
  const { isAuthenticated, isLoading: authLoading } = useAuthStatus();
  const search = Route.useSearch();
  const [overview, setOverview] = useState<WalletOverview | null>(null);
  const [statement, setStatement] = useState<WalletStatementItem[]>([]);
  const [earningEntries, setEarningEntries] = useState<EarningEntry[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [amountYuan, setAmountYuan] = useState("100");
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    try {
      const [nextOverview, nextStatement, nextEntries, nextWithdrawals] = await Promise.all([
        walletApi.getOverview(),
        walletApi.listStatement({ limit: 100 }),
        walletApi.listEarningEntries(),
        walletApi.listWithdrawals(),
      ]);
      setOverview(nextOverview);
      setStatement(nextStatement.items);
      setEarningEntries(nextEntries.items);
      setWithdrawals(nextWithdrawals.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "钱包数据加载失败");
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!isAuthenticated || search.recharge !== "return") return;
    const orderId = sessionStorage.getItem(rechargeStorageKey);
    if (!orderId) return;
    setWorking(true);
    void walletApi
      .reconcileRecharge(orderId)
      .then((order) => {
        if (order.status === "paid") {
          sessionStorage.removeItem(rechargeStorageKey);
          toast.success("充值已到账");
        } else {
          toast.info(`充值订单状态：${order.status}`);
        }
        return load();
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "充值状态确认失败"))
      .finally(() => setWorking(false));
  }, [isAuthenticated, search.recharge, load]);

  const amountFen = useMemo(() => {
    if (!/^\d+(?:\.\d{1,2})?$/.test(amountYuan)) return null;
    const [yuan, fraction = ""] = amountYuan.split(".");
    return BigInt(yuan) * 100n + BigInt(fraction.padEnd(2, "0"));
  }, [amountYuan]);

  const startRecharge = async () => {
    if (amountFen === null || amountFen < 100n) {
      toast.error("请输入至少 1.00 元的充值金额");
      return;
    }
    setWorking(true);
    try {
      const order = await walletApi.createRecharge(String(amountFen), crypto.randomUUID());
      if (!order.payUrl) throw new Error("服务端未返回支付宝收银台地址");
      sessionStorage.setItem(rechargeStorageKey, order.id);
      window.location.assign(order.payUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建充值订单失败");
      setWorking(false);
    }
  };

  const withdrawAll = async () => {
    if (earningEntries.length === 0) return;
    setWorking(true);
    try {
      await walletApi.createWithdrawal(earningEntries.map((entry) => entry.id));
      toast.success("提现申请已提交，等待管理员线下打款");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "提现申请失败");
    } finally {
      setWorking(false);
    }
  };

  if (authLoading) return <main className="section py-12">正在验证登录状态…</main>;
  if (!isAuthenticated) return <SignInPrompt title="登录后查看钱包与账单" />;

  return (
    <main className="section py-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">用户中心</p>
            <h1 className="mt-1 text-3xl font-semibold">钱包与账单</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              充值余额仅用于平台消费；开发者收益独立结算并可申请提现。
            </p>
          </div>
          <Button variant="outline" onClick={() => void load()} disabled={loading || working}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> 刷新
          </Button>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <BalanceCard
            title="可用余额"
            value={overview?.availableFen}
            locale={locale}
            icon={<WalletCards />}
          />
          <BalanceCard
            title="冻结余额"
            value={overview?.frozenFen}
            locale={locale}
            icon={<CreditCard />}
          />
          <BalanceCard
            title="可提现收益"
            value={overview?.withdrawableEarningsFen}
            locale={locale}
            icon={<ArrowDownLeft />}
          />
          <BalanceCard
            title="提现中收益"
            value={overview?.frozenEarningsFen}
            locale={locale}
            icon={<ArrowUpRight />}
          />
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <CardHeader>
              <CardTitle>支付宝充值</CardTitle>
              <CardDescription>支付结果以服务端异步通知和主动查单为准。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {rechargePresets.map((fen) => (
                  <Button
                    key={fen}
                    type="button"
                    variant="outline"
                    onClick={() => setAmountYuan(String(fen / 100))}
                  >
                    {formatWalletCny(String(fen), locale)}
                  </Button>
                ))}
              </div>
              <div className="flex gap-3">
                <Input
                  inputMode="decimal"
                  aria-label="充值金额"
                  value={amountYuan}
                  onChange={(event) => setAmountYuan(event.target.value)}
                  placeholder="充值金额（元）"
                />
                <Button onClick={() => void startRecharge()} disabled={working}>
                  前往支付宝
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>开发者收益提现</CardTitle>
              <CardDescription>首期由管理员审核后线下打款，充值余额不可提现。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-2xl font-semibold">
                {formatWalletCny(overview?.withdrawableEarningsFen ?? "0", locale)}
              </p>
              <p className="text-sm text-muted-foreground">
                当前有 {earningEntries.length} 条可结算收益分录。
              </p>
              <Button
                onClick={() => void withdrawAll()}
                disabled={working || earningEntries.length === 0}
              >
                申请全部提现
              </Button>
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>账单记录</CardTitle>
            <CardDescription>包含充值、消费、退款与提现记录。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y rounded-md border">
              {statement.length === 0 && withdrawals.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">暂无账单记录</p>
              ) : (
                <>
                  {statement.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-3 p-4"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <strong>{entryLabel(item.entryType)}</strong>
                          <Badge>{item.businessType}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {new Date(item.createdAt).toLocaleString(locale)} · {item.businessId}
                        </p>
                      </div>
                      <strong
                        className={
                          BigInt(item.availableDeltaFen) >= 0n
                            ? "text-green-700"
                            : "text-foreground"
                        }
                      >
                        {signedMoney(item.availableDeltaFen, locale)}
                      </strong>
                    </div>
                  ))}
                  {withdrawals.map((item) => (
                    <div
                      key={`withdrawal-${item.id}`}
                      className="flex flex-wrap items-center justify-between gap-3 p-4"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <strong>收益提现</strong>
                          <Badge>{item.status}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {new Date(item.createdAt).toLocaleString(locale)} · {item.id}
                        </p>
                      </div>
                      <strong>-{formatWalletCny(item.amountFen, locale)}</strong>
                    </div>
                  ))}
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function BalanceCard({
  title,
  value,
  locale,
  icon,
}: {
  title: string;
  value?: string;
  locale: string;
  icon: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-2 text-2xl font-semibold">{formatWalletCny(value ?? "0", locale)}</p>
        </div>
        <span className="text-muted-foreground [&>svg]:h-6 [&>svg]:w-6">{icon}</span>
      </CardContent>
    </Card>
  );
}

const entryLabel = (type: WalletStatementItem["entryType"]) =>
  ({
    recharge: "余额充值",
    consume: "余额消费",
    refund: "退款入账",
    freeze: "余额冻结",
    unfreeze: "解除冻结",
    withdraw: "余额提现",
  })[type] ?? type;
