import type { ModelProvider, ModelProviderResolver } from "../contracts/modelProvider.js";
import { ProviderExecutionError } from "./providerErrors.js";

export type ProviderRegistry = Readonly<{
  keys: readonly string[];
  resolve: ModelProviderResolver;
  require: (providerKey: string) => ModelProvider;
}>;

export function createProviderRegistry(providers: readonly ModelProvider[]): ProviderRegistry {
  const entries = new Map<string, ModelProvider>();
  for (const provider of providers) {
    if (!provider.key || provider.key.trim() !== provider.key) {
      throw new Error("Provider key must be a non-empty normalized string");
    }
    if (entries.has(provider.key)) throw new Error(`Duplicate provider key: ${provider.key}`);
    entries.set(provider.key, provider);
  }

  const resolve: ModelProviderResolver = (providerKey) => entries.get(providerKey) ?? null;
  const requireProvider = (providerKey: string): ModelProvider => {
    const provider = resolve(providerKey);
    if (!provider) {
      throw new ProviderExecutionError(
        "provider_unavailable",
        `Provider is unavailable: ${providerKey}`,
      );
    }
    return provider;
  };

  return Object.freeze({
    keys: Object.freeze([...entries.keys()]),
    resolve,
    require: requireProvider,
  });
}
