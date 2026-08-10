type AccessTokenProvider = (forceRefreshToken: boolean) => Promise<string | null>;

let accessTokenProvider: AccessTokenProvider | null = null;

export const setFastifyAccessTokenProvider = (provider: AccessTokenProvider | null): void => {
  accessTokenProvider = provider;
};

export const getFastifyAccessToken = async (forceRefreshToken = false): Promise<string | null> =>
  accessTokenProvider?.(forceRefreshToken) ?? null;
