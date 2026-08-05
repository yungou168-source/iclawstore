import type { OAuthConfig, OAuthUserConfig } from "@auth/core/providers";
import type { WeChatProfile } from "@auth/core/providers/wechat";
import type { TokenSet } from "@auth/core/types";

export function WeChatWebsiteApp(
  options: OAuthUserConfig<WeChatProfile>,
): OAuthConfig<WeChatProfile> {
  const { clientId, clientSecret } = options;
  return {
    id: "wechat",
    name: "WeChat",
    type: "oauth",
    checks: ["state"],
    authorization: {
      url: "https://open.weixin.qq.com/connect/qrconnect",
      params: { appid: clientId, scope: "snsapi_login" },
    },
    token: {
      url: "https://api.weixin.qq.com/sns/oauth2/access_token",
      params: { appid: clientId, secret: clientSecret },
      async conform(response: Response) {
        const data = (await response.json()) as Record<string, unknown>;
        return data.token_type === "bearer"
          ? Response.json(data, response)
          : Response.json({ ...data, token_type: "bearer" }, response);
      },
    },
    userinfo: {
      url: "https://api.weixin.qq.com/sns/userinfo",
      async request({ tokens }: { tokens: TokenSet & { openid?: string } }) {
        const url = new URL("https://api.weixin.qq.com/sns/userinfo");
        url.searchParams.set("access_token", tokens.access_token ?? "");
        url.searchParams.set("openid", String(tokens.openid ?? ""));
        url.searchParams.set("lang", "zh_CN");
        const response = await fetch(url);
        if (!response.ok) throw new Error(`WeChat userinfo failed with HTTP ${response.status}`);
        return await response.json();
      },
    },
    profile(profile) {
      const stableId = profile.unionid || profile.openid;
      if (!stableId) throw new Error("WeChat identity has no unionid or openid");
      return {
        id: stableId,
        name: profile.nickname,
        email: null,
        image: profile.headimgurl,
      };
    },
    options,
  };
}
