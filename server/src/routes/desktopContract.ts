import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import {
  DESKTOP_CLIENT_CONTRACT_VERSION,
  DESKTOP_CLIENT_OPENAPI_PATH,
} from "../desktopContractManifest.js";

export { DESKTOP_CLIENT_CONTRACT_VERSION, DESKTOP_CLIENT_OPENAPI_PATH };

export type DesktopCapabilityStatus =
  | "available"
  | "documented_disabled"
  | "planned"
  | "deprecated";

export type DesktopCapability = {
  status: DesktopCapabilityStatus;
  reason?: string;
  replacedBy?: string;
};

export type DesktopAuthDiscovery = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  jwksUri: string;
  revocationEndpoint: string;
  clientId: string;
  audience: string;
  redirectUris: string[];
  scopes: string[];
  pkceMethods: ["S256"];
};

const available = (): DesktopCapability => ({ status: "available" });
const planned = (reason: string): DesktopCapability => ({ status: "planned", reason });

function desktopRedirectUrisFromEnvironment(env: NodeJS.ProcessEnv): string[] {
  const value = env.AI_DIRECT_DESKTOP_OAUTH_REDIRECT_URIS?.trim();
  if (!value) {
    throw new Error(
      "AI_DIRECT_DESKTOP_OAUTH_REDIRECT_URIS is required when desktop OAuth discovery is enabled",
    );
  }
  const redirectUris = [
    ...new Set(
      value
        .split(",")
        .map((uri) => uri.trim())
        .filter(Boolean),
    ),
  ];
  if (redirectUris.length === 0) {
    throw new Error("AI_DIRECT_DESKTOP_OAUTH_REDIRECT_URIS must contain at least one redirect URI");
  }
  return redirectUris;
}

export function desktopAuthDiscoveryFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): DesktopAuthDiscovery | undefined {
  const issuer = env.CONVEX_DESKTOP_AUTH_ISSUER?.trim().replace(/\/$/, "");
  const clientId = env.AI_DIRECT_DESKTOP_OAUTH_CLIENT_ID?.trim();
  if (!issuer && !clientId) return undefined;
  if (!issuer || !clientId) {
    throw new Error(
      "CONVEX_DESKTOP_AUTH_ISSUER and AI_DIRECT_DESKTOP_OAUTH_CLIENT_ID must be configured together",
    );
  }

  return {
    issuer,
    authorizationEndpoint: `${issuer}/authorize`,
    tokenEndpoint: `${issuer}/token`,
    userinfoEndpoint: `${issuer}/userinfo`,
    jwksUri: `${issuer}/.well-known/jwks.json`,
    revocationEndpoint: `${issuer}/revoke`,
    clientId,
    audience:
      env.CONVEX_DESKTOP_AUTH_AUDIENCE?.trim() ||
      "https://www.iclawstore.com/api/v1/ai-direct-hiring",
    redirectUris: desktopRedirectUrisFromEnvironment(env),
    scopes: ["openid", "profile", "email", "offline_access"],
    pkceMethods: ["S256"],
  };
}

export function paidHiringSupportedFromEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PAID_HIRING_RELEASE_READY === "true";
}

export function desktopCapabilitiesFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, DesktopCapability> {
  const authConfigured = Boolean(
    env.CONVEX_DESKTOP_AUTH_ISSUER?.trim() &&
    env.AI_DIRECT_DESKTOP_OAUTH_CLIENT_ID?.trim() &&
    env.AI_DIRECT_DESKTOP_OAUTH_REDIRECT_URIS?.trim(),
  );
  const paidHiringSupported = paidHiringSupportedFromEnvironment(env);
  return {
    auth: authConfigured
      ? available()
      : {
          status: "documented_disabled",
          reason: "生产环境尚未发布完整 OAuth/OIDC + PKCE 配置，桌面端不得启动原生登录。",
        },
    session: available(),
    agentAppearance: available(),
    desktopSidebar: available(),
    desktopTemplates: available(),
    desktopTemplatePurchase: {
      status: "documented_disabled",
      reason: "模板购买能力在 Desktop API v1 中保持关闭。",
    },
    paidHiring: paidHiringSupported
      ? available()
      : {
          status: "documented_disabled",
          reason: "付费招聘契约已定义，但生产支付与发布门禁尚未启用。",
        },
    jobs: available(),
    jobControl: available(),
    interviews: available(),
    candidateCatalog: available(),
    workforce: available(),
    agentPublication: available(),
    agentPublicationEditing: planned(
      "Agent 单项读取、PATCH 编辑、归档、下架与回滚尚未形成完整桌面契约。",
    ),
    jinshaCredentialSync: {
      status: "documented_disabled",
      reason: "仅在 Provider Runtime 与凭据密钥环配置完成后挂载。",
    },
    jinshaModelPolicy: planned("模型目录与 AgentVersion 模型策略尚未进入桌面生产契约。"),
    deviceManagement: planned("设备注册、设备列表与撤销契约尚未实现。"),
    realtimeEvents: planned("SSE/WebSocket 实时进度与消息通知契约尚未发布。"),
    teamMarketplace: planned("AI 团队市场尚未实现。"),
    localTrialMigration: planned("本地试用数据 preview/apply 迁移尚未实现。"),
    messageChannels: planned("消息渠道 enrollment、回调与投递契约尚未实现。"),
    persistentMemorySync: planned("持久记忆 preview/apply 与授权同步尚未实现。"),
    skinMarketplace: planned("开发者皮肤市场尚未实现。"),
    centralizedGovernance: planned("集中审批、成本、预算和审计查询尚未形成完整桌面契约。"),
    legacyInterviewRead: {
      status: "deprecated",
      reason: "旧命令式已读接口不再使用。",
      replacedBy: "PUT /api/v1/ai-direct-hiring/interviews/{conversationId}/read-cursor",
    },
  };
}

let openApiDocument: Promise<string> | undefined;

function loadOpenApiDocument(): Promise<string> {
  openApiDocument ??= readFile(join(process.cwd(), "openapi", "desktop-client-v1.yaml"), "utf8");
  return openApiDocument;
}

export async function desktopContractRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/contract", async (_request, reply) => {
    const auth = desktopAuthDiscoveryFromEnvironment();
    return reply.status(200).send({
      contract: "ai-direct-hiring-desktop-client",
      product: "AI直聘",
      version: DESKTOP_CLIENT_CONTRACT_VERSION,
      openapi: DESKTOP_CLIENT_OPENAPI_PATH,
      documentation: "/api-docs/desktop",
      capabilityStatusDefinitions: {
        available: "生产已经启用，仍须通过身份、组织权限和会话能力校验。",
        documented_disabled: "契约已定义，但生产功能开关或运行配置关闭。",
        planned: "规划能力，尚未形成可调用的生产接口。",
        deprecated: "兼容保留能力，新客户端不得继续依赖。",
      },
      capabilities: desktopCapabilitiesFromEnvironment(),
      purchaseSupported: false,
      paidHiringSupported: paidHiringSupportedFromEnvironment(),
      ...(auth ? { auth } : {}),
    });
  });

  fastify.get("/openapi.yaml", async (_request, reply) => {
    const document = await loadOpenApiDocument();
    return reply
      .header("Content-Type", "application/vnd.oai.openapi;version=3.1.0;charset=utf-8")
      .header("Cache-Control", "public, max-age=300")
      .send(document);
  });
}
