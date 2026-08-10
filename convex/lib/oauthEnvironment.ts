type RequiredEnvironmentOptions = {
  parseAsUrl?: boolean;
};

export function requiredEnvironment(
  name: string,
  options: RequiredEnvironmentOptions = {},
): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for desktop OAuth`);
  if (options.parseAsUrl === false) return value;

  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error(`${name} must use HTTPS outside local development`);
  }
  return value.replace(/\/$/, "");
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]"]);
const FORBIDDEN_CUSTOM_SCHEMES = new Set(["data:", "file:", "http:", "https:", "javascript:"]);

type DesktopRedirectKind = "custom" | "loopback";

export function desktopOAuthRedirectKind(value: string): DesktopRedirectKind {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid desktop OAuth redirect URI: ${value}`);
  }
  if (url.username || url.password || url.hash) {
    throw new Error("Desktop OAuth redirect URIs cannot contain credentials or fragments");
  }

  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) {
    return "loopback";
  }
  if (FORBIDDEN_CUSTOM_SCHEMES.has(url.protocol)) {
    throw new Error("Desktop OAuth redirects must use a custom scheme or an IP loopback URI");
  }
  return "custom";
}

export function desktopOAuthRedirectUris(): string[] {
  const value = requiredEnvironment("AI_DIRECT_DESKTOP_OAUTH_REDIRECT_URIS", {
    parseAsUrl: false,
  });
  const redirectUris = [
    ...new Set(
      value
        .split(",")
        .map((uri) => uri.trim())
        .filter(Boolean),
    ),
  ];
  const kinds = new Set(redirectUris.map(desktopOAuthRedirectKind));
  if (!kinds.has("custom") || !kinds.has("loopback")) {
    throw new Error(
      "AI_DIRECT_DESKTOP_OAUTH_REDIRECT_URIS must include one custom URI and one IP loopback URI",
    );
  }
  return redirectUris;
}
