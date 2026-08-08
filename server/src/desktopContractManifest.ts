import type { FastifyInstance } from "fastify";

export const DESKTOP_CLIENT_CONTRACT_VERSION = "1.2.0";
export const DESKTOP_CLIENT_OPENAPI_PATH = "/api/v1/desktop/openapi.yaml";

export type DesktopContractRoute = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  openApiPath: string;
  probePath: string;
  public: boolean;
};

const protectedRoute = (
  method: DesktopContractRoute["method"],
  openApiPath: string,
  probePath = openApiPath.replaceAll(/\{[^}]+\}/g, "contract-probe"),
): DesktopContractRoute => ({ method, openApiPath, probePath, public: false });

const publicRoute = (openApiPath: string): DesktopContractRoute => ({
  method: "GET",
  openApiPath,
  probePath: openApiPath,
  public: true,
});

/**
 * Complete method/path surface promised by Desktop Client API 1.2.0.
 * OpenAPI publication, server startup validation, and production smoke tests
 * must all agree with this manifest before the version can be released.
 */
export const DESKTOP_CLIENT_CONTRACT_ROUTES = [
  publicRoute("/api/v1/desktop/contract"),
  publicRoute("/api/v1/desktop/openapi.yaml"),
  protectedRoute("GET", "/api/v1/ai-direct-hiring/agents/{agentId}/appearance"),
  protectedRoute("PATCH", "/api/v1/ai-direct-hiring/agents/{agentId}/appearance"),
  protectedRoute("POST", "/api/v1/ai-direct-hiring/agents/{agentId}/appearance/assets"),
  protectedRoute("POST", "/api/v1/ai-direct-hiring/agents/{agentId}/appearance/assets/reorder"),
  protectedRoute("DELETE", "/api/v1/ai-direct-hiring/agents/{agentId}/appearance/assets/{assetId}"),
  protectedRoute("GET", "/api/v1/ai-direct-hiring/appearance-assets/{assetId}/content"),
  protectedRoute("GET", "/api/v1/ai-direct-hiring/agents/{agentId}/prices"),
  protectedRoute("POST", "/api/v1/ai-direct-hiring/agents/{agentId}/prices"),
  protectedRoute("POST", "/api/v1/ai-direct-hiring/paid-hiring/orders"),
  protectedRoute("GET", "/api/v1/ai-direct-hiring/paid-hiring/orders/{orderId}"),
  protectedRoute("POST", "/api/v1/ai-direct-hiring/paid-hiring/orders/{orderId}/reconcile"),
  protectedRoute("GET", "/api/v1/ai-direct-hiring/offers"),
  protectedRoute("GET", "/api/v1/ai-direct-hiring/offers/{offerId}"),
  protectedRoute("POST", "/api/v1/ai-direct-hiring/employments/{employmentId}/transition"),
  protectedRoute("GET", "/api/v1/desktop/sidebar"),
  protectedRoute("PUT", "/api/v1/desktop/sidebar"),
  protectedRoute("DELETE", "/api/v1/desktop/sidebar"),
  protectedRoute("POST", "/api/v1/desktop/sidebar/icons"),
  protectedRoute("GET", "/api/v1/desktop/sidebar/icons/{assetId}/content"),
  protectedRoute("DELETE", "/api/v1/desktop/sidebar/icons/{assetId}"),
  protectedRoute("GET", "/api/v1/desktop/templates"),
  protectedRoute("POST", "/api/v1/desktop/templates"),
  protectedRoute("GET", "/api/v1/desktop/templates/{templateId}"),
  protectedRoute("PATCH", "/api/v1/desktop/templates/{templateId}"),
  protectedRoute("POST", "/api/v1/desktop/templates/{templateId}/versions"),
  protectedRoute("POST", "/api/v1/desktop/templates/{templateId}/versions/{versionId}/screenshots"),
  protectedRoute("POST", "/api/v1/desktop/templates/{templateId}/versions/{versionId}/submit"),
  protectedRoute("POST", "/api/v1/desktop/templates/{templateId}/versions/{versionId}/approve"),
  protectedRoute("GET", "/api/v1/desktop/templates/{templateId}/package"),
  protectedRoute("GET", "/api/v1/desktop/template-screenshots/{assetId}/content"),
  protectedRoute("PUT", "/api/v1/desktop/templates/{templateId}/entitlements/{userId}"),
  protectedRoute("DELETE", "/api/v1/desktop/templates/{templateId}/entitlements/{userId}"),
  protectedRoute("GET", "/api/v1/ai-direct-hiring/session"),
  protectedRoute("GET", "/api/v1/ai-direct-hiring/jobs"),
  protectedRoute("GET", "/api/v1/ai-direct-hiring/jobs/{runId}"),
  protectedRoute("GET", "/api/v1/ai-direct-hiring/jobs/{runId}/artifacts"),
  protectedRoute("GET", "/api/v1/ai-direct-hiring/jobs/{runId}/artifacts/{artifactId}/content"),
  protectedRoute("POST", "/api/v1/ai-direct-hiring/interviews"),
  protectedRoute("PUT", "/api/v1/ai-direct-hiring/interviews/{conversationId}/model-consent"),
  protectedRoute("GET", "/api/v1/ai-direct-hiring/interviews/{conversationId}/messages"),
  protectedRoute("POST", "/api/v1/ai-direct-hiring/interviews/{conversationId}/messages"),
  protectedRoute(
    "DELETE",
    "/api/v1/ai-direct-hiring/interviews/{conversationId}/messages/{messageId}",
  ),
  protectedRoute("PUT", "/api/v1/ai-direct-hiring/interviews/{conversationId}/read-cursor"),
  protectedRoute("GET", "/api/v1/ai-direct-hiring/interview-retention-policies/{organizationId}"),
  protectedRoute("PUT", "/api/v1/ai-direct-hiring/interview-retention-policies/{organizationId}"),
  protectedRoute("POST", "/api/v1/ai-direct-hiring/interview-legal-holds"),
  protectedRoute("DELETE", "/api/v1/ai-direct-hiring/interview-legal-holds/{holdId}"),
  protectedRoute("GET", "/api/v1/ai-direct-hiring/catalog/agents"),
  protectedRoute("GET", "/api/v1/ai-direct-hiring/catalog/agents/{agentId}"),
  protectedRoute("GET", "/api/v1/ai-direct-hiring/catalog/categories"),
  protectedRoute("GET", "/api/v1/ai-direct-hiring/workforce/employees"),
  protectedRoute("GET", "/api/v1/ai-direct-hiring/workforce/departments"),
  protectedRoute("POST", "/api/v1/ai-direct-hiring/workforce/departments"),
  protectedRoute("GET", "/api/v1/ai-direct-hiring/workforce/positions"),
  protectedRoute("POST", "/api/v1/ai-direct-hiring/workforce/positions"),
  protectedRoute(
    "GET",
    "/api/v1/ai-direct-hiring/workforce/positions/{positionId}/candidate-matches",
  ),
] as const satisfies readonly DesktopContractRoute[];

export function missingDesktopContractRoutes(
  fastify: FastifyInstance,
  routes: readonly DesktopContractRoute[] = DESKTOP_CLIENT_CONTRACT_ROUTES,
): DesktopContractRoute[] {
  return routes.filter(
    (route) => !fastify.findRoute({ method: route.method, url: route.probePath }),
  );
}

export function assertDesktopContractRoutes(
  fastify: FastifyInstance,
  routes: readonly DesktopContractRoute[] = DESKTOP_CLIENT_CONTRACT_ROUTES,
): void {
  const missing = missingDesktopContractRoutes(fastify, routes);
  if (missing.length === 0) return;

  const details = missing.map(({ method, openApiPath }) => `${method} ${openApiPath}`).join(", ");
  throw new Error(
    `Desktop Client API ${DESKTOP_CLIENT_CONTRACT_VERSION} contract routes are not mounted: ${details}`,
  );
}
