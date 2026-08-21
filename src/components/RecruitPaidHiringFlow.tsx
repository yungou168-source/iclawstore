import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  aiDirectOrganizationApi,
  type CompanyDto,
  type DepartmentDto,
  type PositionDto,
  type PositionRoleDto,
} from "../lib/aiDirectOrganizationApi";
import {
  aiDirectPaidHiringApi as api,
  formatCnyFen,
  PaidHiringApiError,
  type CandidateCatalogItemDto,
  type PaidHiringOrderDto,
} from "../lib/aiDirectPaidHiringApi";
import { useLocale } from "../lib/i18n/context";
import { useAuthStatus } from "../lib/useAuthStatus";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

const orderStorageKey = "ai-direct-paid-hiring-order-id";
const errorMessage = (error: unknown, fallback: () => string) =>
  error instanceof Error ? error.message : fallback();
const newIdempotencyKey = () => crypto.randomUUID();

export function RecruitPaidHiringFlow() {
  const { locale, t } = useLocale();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuthStatus();
  const navigate = useNavigate();
  const [companies, setCompanies] = useState<CompanyDto[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [departments, setDepartments] = useState<DepartmentDto[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [positions, setPositions] = useState<PositionDto[]>([]);
  const [positionId, setPositionId] = useState("");
  const [roles, setRoles] = useState<PositionRoleDto[]>([]);
  const [roleId, setRoleId] = useState("");
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [category, setCategory] = useState("");
  const [candidates, setCandidates] = useState<CandidateCatalogItemDto[]>([]);
  const [agentId, setAgentId] = useState("");
  const [order, setOrder] = useState<PaidHiringOrderDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCompanies = useCallback(async () => {
    if (isAuthLoading) return;
    if (!isAuthenticated) {
      setCompanies([]);
      setCompanyId("");
      setLoading(false);
      return;
    }
    try {
      const orgs = await aiDirectOrganizationApi.listOrganizations("active");
      const groups = await Promise.all(
        orgs.items.map((org) => aiDirectOrganizationApi.listCompanies(org.id, "active")),
      );
      const available = groups
        .flatMap((page) => page.items)
        .filter(
          (company) =>
            company.companyRole === "recruiter" ||
            company.companyRole === "admin" ||
            company.companyRole === "owner",
        );
      setCompanies(available);
      setCompanyId((current) =>
        available.some((company) => company.id === current) ? current : (available[0]?.id ?? ""),
      );
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught, () => t("ai_direct.common.not_completed")));
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, isAuthLoading]);

  const loadDepartments = useCallback(async () => {
    if (!companyId) {
      setDepartments([]);
      return;
    }
    try {
      const page = await aiDirectOrganizationApi.listDepartments(companyId);
      const next = page.items.filter((item) => item.status === "active");
      setDepartments(next);
      setDepartmentId(next[0]?.id ?? "");
    } catch (caught) {
      setError(errorMessage(caught, () => t("ai_direct.common.not_completed")));
    }
  }, [companyId]);

  const loadPositions = useCallback(async () => {
    if (!departmentId) {
      setPositions([]);
      return;
    }
    try {
      const page = await aiDirectOrganizationApi.listPositions(departmentId);
      const next = page.items.filter(
        (item) => item.status === "open" && item.headcountFilled < item.headcountTarget,
      );
      setPositions(next);
      setPositionId(next[0]?.id ?? "");
    } catch (caught) {
      setError(errorMessage(caught, () => t("ai_direct.common.not_completed")));
    }
  }, [departmentId]);

  const loadRoles = useCallback(async () => {
    if (!positionId) {
      setRoles([]);
      return;
    }
    try {
      const response = await aiDirectOrganizationApi.listPositionRoles(positionId);
      const next = response.items.filter((item) => item.status === "open");
      setRoles(next);
      setRoleId(next[0]?.id ?? "");
    } catch (caught) {
      setError(errorMessage(caught, () => t("ai_direct.common.not_completed")));
    }
  }, [positionId]);

  const loadCategories = useCallback(async () => {
    const company = companies.find((item) => item.id === companyId);
    if (!company) {
      setCategories([]);
      return;
    }
    try {
      const response = await api.listCandidateCategories(company.organizationId);
      setCategories(
        response.items.map((item) => ({
          id: item.categoryKey,
          name: `${item.categoryKey} (${item.candidateCount})`,
        })),
      );
    } catch (caught) {
      setError(errorMessage(caught, () => t("ai_direct.common.not_completed")));
    }
  }, [companies, companyId]);

  const loadCandidates = useCallback(async () => {
    const company = companies.find((item) => item.id === companyId);
    try {
      const page = company
        ? await api.listCandidateCatalog(company.organizationId, { category, limit: 50 })
        : await api.listPublicCatalog(50);
      const next = page.items.filter(
        (item) =>
          item.availability === "available" &&
          item.priceStatus === "active" &&
          (company || !category || item.category === category),
      );
      setCandidates(next);
      if (!company && !category) {
        const categoryKeys = Array.from(new Set(next.map((item) => item.category).filter(Boolean)));
        setCategories(categoryKeys.map((key) => ({ id: key as string, name: key as string })));
      }
      setAgentId((current) => (next.some((item) => item.agentId === current) ? current : ""));
    } catch (caught) {
      setError(errorMessage(caught, () => t("ai_direct.common.not_completed")));
    }
  }, [category, companies, companyId]);

  useEffect(() => {
    void loadCompanies();
  }, [loadCompanies]);
  useEffect(() => {
    void loadDepartments();
  }, [loadDepartments]);
  useEffect(() => {
    void loadPositions();
  }, [loadPositions]);
  useEffect(() => {
    void loadRoles();
  }, [loadRoles]);
  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);
  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);
  useEffect(() => {
    const saved = sessionStorage.getItem(orderStorageKey);
    if (saved)
      void api
        .getOrder(saved)
        .then(setOrder)
        .catch(() => sessionStorage.removeItem(orderStorageKey));
  }, []);

  const handleCompanyChange = (nextCompanyId: string) => {
    setCompanyId(nextCompanyId);
    setCategory("");
    setAgentId("");
  };

  const selectedRole = roles.find((item) => item.id === roleId) ?? null;
  const canCreateOrder = Boolean(companyId && positionId && roleId && agentId && selectedRole);

  const startPayment = async () => {
    if (!selectedRole || !canCreateOrder) return;
    setWorking(true);
    setError(null);
    try {
      const created = await api.createOrder(
        { companyId, projectId: selectedRole.projectId, roleId, positionId, agentId },
        newIdempotencyKey(),
      );
      setOrder(created);
      if (created.status === "fulfilled") {
        sessionStorage.removeItem(orderStorageKey);
      } else {
        sessionStorage.setItem(orderStorageKey, created.id);
      }
    } catch (caught) {
      if (caught instanceof PaidHiringApiError && caught.code === "BUDGET_EXCEEDED") {
        void navigate({ to: "/wallet", search: { recharge: undefined } });
        return;
      }
      setError(errorMessage(caught, () => t("ai_direct.common.not_completed")));
    } finally {
      setWorking(false);
    }
  };

  const reconcile = async () => {
    if (!order) return;
    setWorking(true);
    setError(null);
    try {
      setOrder(await api.reconcileOrder(order.id));
    } catch (caught) {
      setError(
        caught instanceof PaidHiringApiError && caught.isReconcileCooldown
          ? t("ai_direct.recruitment.reconcile_cooldown")
          : errorMessage(caught, () => t("ai_direct.common.not_completed")),
      );
    } finally {
      setWorking(false);
    }
  };

  const reloadOrder = async () => {
    if (!order) return;
    setWorking(true);
    setError(null);
    try {
      setOrder(await api.getOrder(order.id));
    } catch (caught) {
      setError(errorMessage(caught, () => t("ai_direct.common.not_completed")));
    } finally {
      setWorking(false);
    }
  };

  return (
    <main className="desktop-home">
      <section className="desktop-home-container py-10">
        <header className="mb-8">
          <p className="text-sm font-medium text-muted-foreground">
            {t("ai_direct.recruitment.directory")}
          </p>
          <h1 className="text-3xl font-semibold">{t("ai_direct.recruitment.title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("ai_direct.recruitment.subtitle")}
          </p>
        </header>
        {error ? (
          <p
            role="alert"
            className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}
        {order ? (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>{t("ai_direct.recruitment.order")}</CardTitle>
              <CardDescription>订单 ID：{order.id}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p>
                状态：<strong>{order.status}</strong> · 金额：
                {formatCnyFen(order.grossAmountFen, locale)}
              </p>
              {order.status === "fulfilled" && order.offerId && order.employmentId ? (
                <p
                  role="status"
                  className="rounded-md border border-green-600/30 bg-green-50 p-3 text-sm"
                >
                  雇佣已成功确认。Offer：{order.offerId}；Employment：{order.employmentId}
                </p>
              ) : null}
              {order.status === "pending" ? (
                <div className="flex flex-wrap gap-2">
                  <Button disabled={working} onClick={() => void reloadOrder()}>
                    刷新本地状态
                  </Button>
                  <Button variant="outline" disabled={working} onClick={() => void reconcile()}>
                    向渠道显式对账
                  </Button>
                </div>
              ) : null}
              {order.status === "closed" ? (
                <p className="text-sm text-muted-foreground">
                  该订单已关闭。请重新选择岗位和 Agent 后创建新订单。
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("ai_direct.recruitment.context")}</CardTitle>
              <CardDescription>所有可选项均来自当前身份可访问的服务端资源。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Select
                label="公司"
                value={companyId}
                items={companies}
                disabled={loading}
                onChange={handleCompanyChange}
              />
              <Select
                label="部门"
                value={departmentId}
                items={departments}
                onChange={setDepartmentId}
              />
              <Select
                label="开放职位"
                value={positionId}
                items={positions}
                onChange={setPositionId}
              />
              <Select label="绑定 Role" value={roleId} items={roles} onChange={setRoleId} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("ai_direct.recruitment.candidates")}</CardTitle>
              <CardDescription>
                候选目录只显示服务端可见且价格状态为 active 的 Agent。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Select label="候选分类" value={category} items={categories} onChange={setCategory} />
              {candidates.map((candidate) => (
                <label
                  key={candidate.agentId}
                  className="flex cursor-pointer items-center gap-3 rounded-md border p-3"
                >
                  <input
                    type="radio"
                    name="agent"
                    checked={agentId === candidate.agentId}
                    onChange={() => setAgentId(candidate.agentId)}
                  />
                  <span>
                    <strong>{candidate.displayName}</strong>
                    <span className="block text-xs text-muted-foreground">
                      {candidate.summary ?? "暂无简介"}
                    </span>
                  </span>
                </label>
              ))}
              {!loading && candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  当前组织没有可支付雇佣的候选 Agent。
                </p>
              ) : null}
              <Button disabled={working || !canCreateOrder} onClick={() => void startPayment()}>
                {t("ai_direct.recruitment.start_payment")}
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}

function Select({
  label,
  value,
  items,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  items: Array<{ id: string; name: string }>;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span>{label}</span>
      <select
        value={value}
        disabled={disabled || items.length === 0}
        className="min-h-10 rounded-md border bg-background px-3"
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">请选择</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </label>
  );
}
