import { useCallback, useEffect, useMemo, useState } from "react";
import {
  aiDirectPaidHiringApi as api,
  formatCnyFen,
  type AgentPriceDto,
  type OwnedAgentDto,
  type OwnedAgentVersionDto,
} from "../../lib/aiDirectPaidHiringApi";
import { useLocale } from "../../lib/i18n/context";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

const message = (error: unknown) =>
  error instanceof Error ? error.message : "请求未完成，请稍后重试。";

export function DeveloperPricingPage() {
  const { locale, t } = useLocale();
  const [agents, setAgents] = useState<OwnedAgentDto[]>([]);
  const [agentId, setAgentId] = useState("");
  const [versions, setVersions] = useState<OwnedAgentVersionDto[]>([]);
  const [prices, setPrices] = useState<AgentPriceDto[]>([]);
  const [versionId, setVersionId] = useState("");
  const [amountFen, setAmountFen] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.listOwnedAgents();
      setAgents(response.items);
      setAgentId((current) =>
        response.items.some((agent) => agent.id === current)
          ? current
          : (response.items[0]?.id ?? ""),
      );
      setError(null);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAgentContext = useCallback(async () => {
    if (!agentId) {
      setVersions([]);
      setPrices([]);
      return;
    }
    try {
      const [versionResponse, priceResponse] = await Promise.all([
        api.listOwnedAgentVersions(agentId),
        api.listAgentPrices(agentId),
      ]);
      setVersions(versionResponse.items);
      setPrices(priceResponse.prices);
      setVersionId((current) =>
        versionResponse.items.some(
          (version) => version.id === current && version.status === "published",
        )
          ? current
          : (versionResponse.items.find((version) => version.status === "published")?.id ?? ""),
      );
      setError(null);
    } catch (caught) {
      setError(message(caught));
    }
  }, [agentId]);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);
  useEffect(() => {
    void loadAgentContext();
  }, [loadAgentContext]);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === agentId) ?? null,
    [agentId, agents],
  );
  const activePrice = prices.find((price) => price.status === "active") ?? null;
  const validAmount =
    /^\d+$/.test(amountFen) && Number(amountFen) > 0 && Number.isSafeInteger(Number(amountFen));

  const setPrice = async () => {
    if (!agentId || !versionId || !validAmount) return;
    setWorking(true);
    try {
      await api.setAgentPrice(agentId, { agentVersionId: versionId, amountFen: Number(amountFen) });
      setAmountFen("");
      await loadAgentContext();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setWorking(false);
    }
  };

  return (
    <main className="section mx-auto flex max-w-5xl flex-col gap-5">
      <div className="section-header">
        <div>
          <h1 className="section-title">{t("ai_direct.pricing.title")}</h1>
          <p className="section-subtitle">{t("ai_direct.pricing.subtitle")}</p>
        </div>
        <Button variant="outline" disabled={loading} onClick={() => void loadAgents()}>
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
      <Card>
        <CardHeader>
          <CardTitle>{t("ai_direct.pricing.my_agents")}</CardTitle>
          <CardDescription>{t("ai_direct.pricing.visible_agents")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {agents.map((agent) => (
            <Button
              key={agent.id}
              variant={agent.id === agentId ? "primary" : "outline"}
              onClick={() => setAgentId(agent.id)}
            >
              {agent.name}
              <Badge>{agent.status}</Badge>
            </Button>
          ))}
          {!loading && agents.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("ai_direct.pricing.empty_agents")}</p>
          ) : null}
        </CardContent>
      </Card>
      {selectedAgent ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("ai_direct.pricing.append")}</CardTitle>
              <CardDescription>
                {t("ai_direct.pricing.current_agent", { name: selectedAgent.name })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="price-version">已发布版本</Label>
                <select
                  id="price-version"
                  value={versionId}
                  onChange={(event) => setVersionId(event.target.value)}
                  className="min-h-10 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="">{t("ai_direct.pricing.select_published_version")}</option>
                  {versions
                    .filter((version) => version.status === "published")
                    .map((version) => (
                      <option key={version.id} value={version.id}>
                        v{version.version}
                      </option>
                    ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="price-fen">{t("ai_direct.pricing.amount_fen")}</Label>
                <Input
                  id="price-fen"
                  inputMode="numeric"
                  value={amountFen}
                  onChange={(event) => setAmountFen(event.target.value.replace(/\D/g, ""))}
                  placeholder={t("ai_direct.pricing.amount_placeholder")}
                />
                <p className="text-xs text-muted-foreground">
                  {validAmount
                    ? t("ai_direct.pricing.preview", { amount: formatCnyFen(amountFen, locale) })
                    : t("ai_direct.pricing.integer_required")}
                </p>
              </div>
              <Button
                disabled={working || !versionId || !validAmount}
                onClick={() => void setPrice()}
              >
                设置新价格
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("ai_direct.pricing.history")}</CardTitle>
              <CardDescription>不能编辑或删除既有价格。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {activePrice ? (
                <p className="rounded-md border p-3 text-sm">
                  当前生效：<strong>{formatCnyFen(activePrice.amountFen, locale)}</strong> · v
                  {activePrice.version}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">尚未设置雇佣价格。</p>
              )}
              {prices.map((price) => (
                <div
                  key={price.id}
                  className="flex items-center justify-between rounded-md border p-3 text-sm"
                >
                  <span>
                    v{price.version} · Agent 版本 {price.agentVersionId}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge>{price.status}</Badge>
                    <strong>{formatCnyFen(price.amountFen, locale)}</strong>
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </main>
  );
}
