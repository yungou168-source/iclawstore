/* @vitest-environment node */

import { Agent, setGlobalDispatcher } from "undici";
import { describe, expect, it } from "vitest";
import {
  DESKTOP_CLIENT_CONTRACT_ROUTES,
  DESKTOP_CLIENT_CONTRACT_VERSION,
} from '../server/src/desktopContractManifest.js';

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_RATE_LIMIT_WAIT_MS = 15_000;
const TRANSIENT_RETRY_DELAY_MS = 1_000;

try {
  setGlobalDispatcher(
    new Agent({
      connect: { timeout: REQUEST_TIMEOUT_MS },
    }),
  );
} catch {
  // ignore dispatcher setup failures
}

function getSiteBase() {
  return (
    process.env.CLAWHUB_E2E_SITE?.trim() ||
    process.env.CLAWHUB_SITE?.trim() ||
    "https://www.iclawstore.com"
  );
}

function getDesktopApiBase() {
  return process.env.DESKTOP_API_BASE_URL?.trim() || 'https://www.iclawstore.com';
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Timeout")), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function parsePositiveNumber(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getRetryDelayMs(response: Response) {
  const retryAfterSeconds = parsePositiveNumber(response.headers.get("Retry-After"));
  if (retryAfterSeconds !== null) {
    return Math.min(retryAfterSeconds * 1000, MAX_RATE_LIMIT_WAIT_MS);
  }

  const relativeResetSeconds = parsePositiveNumber(response.headers.get("RateLimit-Reset"));
  if (relativeResetSeconds !== null) {
    return Math.min(relativeResetSeconds * 1000, MAX_RATE_LIMIT_WAIT_MS);
  }

  const absoluteResetSeconds = parsePositiveNumber(response.headers.get("X-RateLimit-Reset"));
  if (absoluteResetSeconds !== null) {
    return Math.min(Math.max(absoluteResetSeconds * 1000 - Date.now(), 0), MAX_RATE_LIMIT_WAIT_MS);
  }

  return 1000;
}

async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: { maxAttempts?: number; timeoutMs?: number } = {},
) {
  const maxAttempts = options.maxAttempts ?? MAX_RATE_LIMIT_RETRIES;
  let lastError: unknown;
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetchWithTimeout(input, init, options.timeoutMs);
      if (attempt >= maxAttempts) return response;
      if (response.status === 429) {
        await new Promise((resolve) => setTimeout(resolve, getRetryDelayMs(response)));
        continue;
      }
      if (response.status >= 500) {
        await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAY_MS * attempt));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAY_MS * attempt));
    }
  }

  throw lastError;
}

async function fetchHtml(pathname: string) {
  const response = await fetchWithRetry(new URL(pathname, getSiteBase()), {
    headers: { Accept: "text/html" },
  });
  expect(response.ok).toBe(true);
  expect(response.headers.get("content-type")).toContain("text/html");
  return response.text();
}

describe("prod http smoke", () => {
  it("serves the AI Work home page shell from prod", async () => {
    const html = await fetchHtml("/");

    expect(html).toContain("<title>AI直聘</title>");
    expect(html).toContain('href="/recruit-ai"');
    expect(html).toContain('href="/plugins"');
    expect(html).not.toContain("Something went wrong!");
  });

  it("serves the AI employee directory from prod", async () => {
    const html = await fetchHtml("/recruit-ai");

    expect(html).toContain("AI 员工目录");
    expect(html).toContain("在客户端继续招聘");
    expect(html).not.toContain("Something went wrong!");
  });

  it("serves the site og image", async () => {
    const response = await fetchWithRetry(new URL("/og.svg", getSiteBase()));

    expect(response.ok).toBe(true);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
  });
});

describe('desktop client production contract', () => {
  it('publishes the expected discovery and OpenAPI version', async () => {
    const discoveryResponse = await fetchWithRetry(
      new URL('/api/v1/desktop/contract', getDesktopApiBase()),
    );
    expect(discoveryResponse.status).toBe(200);
    const discovery = (await discoveryResponse.json()) as { version?: string; openapi?: string };
    expect(discovery.version).toBe(DESKTOP_CLIENT_CONTRACT_VERSION);

    const openApiResponse = await fetchWithRetry(
      new URL(discovery.openapi || '/api/v1/desktop/openapi.yaml', getDesktopApiBase()),
    );
    expect(openApiResponse.status).toBe(200);
    expect(await openApiResponse.text()).toContain(
      `version: ${DESKTOP_CLIENT_CONTRACT_VERSION}`,
    );
  });

  it('does not return 404 for any protected operation promised by 1.1.0', async () => {
    const missing: string[] = [];
    for (const route of DESKTOP_CLIENT_CONTRACT_ROUTES) {
      if (route.public) continue;
      const hasBody = route.method === 'POST' || route.method === 'PUT' || route.method === 'PATCH';
      const response = await fetchWithRetry(new URL(route.probePath, getDesktopApiBase()), {
        method: route.method,
        headers: {
          Accept: 'application/json',
          ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(hasBody ? { body: '{}' } : {}),
      });
      if (response.status === 404) missing.push(`${route.method} ${route.openApiPath}`);
    }

    expect(missing, `OpenAPI operations missing in production: ${missing.join(', ')}`).toEqual([]);
  });
});
