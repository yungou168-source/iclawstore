import { getFastifyAccessToken } from "./fastifyAuthToken";

const BASE = "/api/v1/ai-direct-hiring";

export type FriendlyLinkDto = {
  id: string;
  label: string;
  url: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type FriendlyLinkInput = Pick<
  FriendlyLinkDto,
  "label" | "url" | "description" | "sortOrder" | "isActive"
>;

type FriendlyLinkList = { items: FriendlyLinkDto[] };
type ApiErrorPayload = { error?: string; message?: string };

const request = async <T>(
  path: string,
  options: RequestInit = {},
  authenticated = false,
): Promise<T> => {
  const send = async (refresh: boolean) => {
    const headers = new Headers(options.headers);
    if (options.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (authenticated) {
      const token = await getFastifyAccessToken(refresh);
      if (token) headers.set("Authorization", `Bearer ${token}`);
    }
    return fetch(`${BASE}${path}`, { ...options, headers, credentials: "omit" });
  };
  let response = await send(false);
  if (authenticated && response.status === 401) response = await send(true);
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload;
    throw new Error(payload.error ?? payload.message ?? `HTTP ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
};

export const friendlyLinksApi = {
  listPublic: () => request<FriendlyLinkList>("/friendly-links"),
  listAdmin: () => request<FriendlyLinkList>("/admin/friendly-links", {}, true),
  create: (input: FriendlyLinkInput) =>
    request<FriendlyLinkDto>(
      "/admin/friendly-links",
      { method: "POST", body: JSON.stringify(input) },
      true,
    ),
  update: (id: string, input: FriendlyLinkInput) =>
    request<FriendlyLinkDto>(
      `/admin/friendly-links/${encodeURIComponent(id)}`,
      { method: "PUT", body: JSON.stringify(input) },
      true,
    ),
  remove: (id: string) =>
    request<void>(`/admin/friendly-links/${encodeURIComponent(id)}`, { method: "DELETE" }, true),
};
