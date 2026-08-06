const convexAuthIssuer = process.env.CONVEX_SITE_URL;
const desktopOAuthBase = process.env.CUSTOM_AUTH_SITE_URL;

export default {
  providers: [
    {
      domain: convexAuthIssuer,
      applicationID: "convex",
    },
    ...(desktopOAuthBase
      ? [
          {
            domain: `${desktopOAuthBase.replace(/\/$/, "")}/oauth/desktop`,
            applicationID: "https://www.iclawstore.com/api/v1/ai-direct-hiring",
          },
        ]
      : []),
  ],
};
