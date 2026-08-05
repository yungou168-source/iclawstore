import { useConvexAuth } from "@convex-dev/auth/react";
import { useEffect } from "react";
import { setFastifyAccessTokenProvider } from "../lib/fastifyAuthToken";

export function FastifyAuthTokenBridge() {
  const { isAuthenticated, fetchAccessToken } = useConvexAuth();

  useEffect(() => {
    if (!isAuthenticated) {
      setFastifyAccessTokenProvider(null);
      return;
    }
    setFastifyAccessTokenProvider((forceRefreshToken) => fetchAccessToken({ forceRefreshToken }));
    return () => setFastifyAccessTokenProvider(null);
  }, [fetchAccessToken, isAuthenticated]);

  return null;
}
