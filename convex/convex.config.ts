import oauthProvider from "@codefox-inc/oauth-provider/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();

app.use(oauthProvider, { name: "oauthProvider" });

export default app;
