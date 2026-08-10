export type ProviderRateLimit = Readonly<{
  requestsPerMinute: number;
  tokensPerMinute: number;
}>;

type Bucket = {
  requestTokens: number;
  modelTokens: number;
  updatedAt: number;
};

export type ProviderRateLimiter = Readonly<{
  acquire: (
    providerKey: string,
    modelKey: string,
    estimatedTokens: number,
    limits: ProviderRateLimit,
    signal: AbortSignal,
  ) => Promise<void>;
}>;

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${field} must be a positive integer`);
  return value;
}

function waitForAbort(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? new Error("Rate limit wait aborted"));
    const timer = setTimeout(done, milliseconds);
    function done() {
      signal.removeEventListener("abort", aborted);
      resolve();
    }
    function aborted() {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Rate limit wait aborted"));
    }
    signal.addEventListener("abort", aborted, { once: true });
  });
}

export function createProviderRateLimiter(
  now: () => number = Date.now,
  sleep: (milliseconds: number, signal: AbortSignal) => Promise<void> = waitForAbort,
): ProviderRateLimiter {
  const buckets = new Map<string, Bucket>();

  return Object.freeze({
    acquire: async (providerKey, modelKey, estimatedTokens, limits, signal) => {
      const rpm = positiveInteger(limits.requestsPerMinute, "requestsPerMinute");
      const tpm = positiveInteger(limits.tokensPerMinute, "tokensPerMinute");
      const requestedTokens = positiveInteger(estimatedTokens, "estimatedTokens");
      if (requestedTokens > tpm) throw new Error("Estimated tokens exceed the provider TPM limit");
      const key = `${providerKey}\0${modelKey}`;

      while (true) {
        const timestamp = now();
        const bucket = buckets.get(key) ?? {
          requestTokens: rpm,
          modelTokens: tpm,
          updatedAt: timestamp,
        };
        const elapsed = Math.max(0, timestamp - bucket.updatedAt);
        bucket.requestTokens = Math.min(rpm, bucket.requestTokens + (elapsed * rpm) / 60_000);
        bucket.modelTokens = Math.min(tpm, bucket.modelTokens + (elapsed * tpm) / 60_000);
        bucket.updatedAt = timestamp;
        buckets.set(key, bucket);

        if (bucket.requestTokens >= 1 && bucket.modelTokens >= requestedTokens) {
          bucket.requestTokens -= 1;
          bucket.modelTokens -= requestedTokens;
          return;
        }
        const requestWait =
          bucket.requestTokens >= 1 ? 0 : Math.ceil(((1 - bucket.requestTokens) * 60_000) / rpm);
        const tokenWait =
          bucket.modelTokens >= requestedTokens
            ? 0
            : Math.ceil(((requestedTokens - bucket.modelTokens) * 60_000) / tpm);
        await sleep(Math.max(1, requestWait, tokenWait), signal);
      }
    },
  });
}
