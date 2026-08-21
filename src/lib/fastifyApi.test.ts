import { afterEach, describe, expect, it, vi } from "vitest";
import { FastifyApiClient } from "./fastifyApi";
import { setFastifyAccessTokenProvider } from "./fastifyAuthToken";

afterEach(() => {
  setFastifyAccessTokenProvider(null);
  vi.unstubAllGlobals();
});

describe("FastifyApiClient authentication", () => {
  it("injects the current Convex access token and omits cookies", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ organizations: [] }));
    vi.stubGlobal("fetch", fetchMock);
    setFastifyAccessTokenProvider(async () => "short-lived-token");

    await new FastifyApiClient("/api").getAiDirectSession();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer short-lived-token");
    expect(init.credentials).toBe("omit");
  });

  it("force refreshes once after an authenticated 401", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ code: "AUTH_REQUIRED" }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ organizations: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const tokenProvider = vi.fn(async (forceRefresh: boolean) =>
      forceRefresh ? "refreshed-token" : "expired-token",
    );
    setFastifyAccessTokenProvider(tokenProvider);

    await new FastifyApiClient("/api").getAiDirectSession("org-1");

    expect(tokenProvider.mock.calls).toEqual([[false], [true]]);
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("authorization")).toBe(
      "Bearer refreshed-token",
    );
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("x-organization-id")).toBe(
      "org-1",
    );
  });

  it("does not retry an anonymous 401", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ error: "Authentication required" }, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new FastifyApiClient("/api").getAiDirectSession()).rejects.toThrow(
      "Authentication required",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
