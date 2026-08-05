export type ProviderPricing = Readonly<{
  currency: 'USD';
  inputMicrosPerMillionTokens: bigint;
  outputMicrosPerMillionTokens: bigint;
}>;

export type ProviderBudget = Readonly<{
  estimatedInputTokens: number;
  maxOutputTokens: number;
  maxCostMicros: bigint;
}>;

const ONE_MILLION = 1_000_000n;

function readNonNegativeInteger(value: unknown, field: string): bigint {
  if (
    (typeof value !== 'number' && typeof value !== 'string')
    || !/^\d+$/.test(String(value))
  ) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${field} exceeds the supported range`);
  }
  return parsed;
}

function tokenCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
}

export function parseProviderPricing(value: unknown): ProviderPricing {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Model pricing must be an object');
  }
  const pricing = value as Record<string, unknown>;
  if (pricing.currency !== 'USD') throw new Error('Model pricing currency must be USD');
  return Object.freeze({
    currency: 'USD',
    inputMicrosPerMillionTokens: readNonNegativeInteger(
      pricing.inputMicrosPerMillionTokens,
      'pricing.inputMicrosPerMillionTokens',
    ),
    outputMicrosPerMillionTokens: readNonNegativeInteger(
      pricing.outputMicrosPerMillionTokens,
      'pricing.outputMicrosPerMillionTokens',
    ),
  });
}

export function parseProviderBudget(value: unknown): ProviderBudget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Provider execution budget must be an object');
  }
  const budget = value as Record<string, unknown>;
  return Object.freeze({
    estimatedInputTokens: tokenCount(budget.estimatedInputTokens, 'budget.estimatedInputTokens'),
    maxOutputTokens: tokenCount(budget.maxOutputTokens, 'budget.maxOutputTokens'),
    maxCostMicros: readNonNegativeInteger(budget.maxCostMicros, 'budget.maxCostMicros'),
  });
}

function pricedTokens(tokens: number, rate: bigint): bigint {
  return (BigInt(tokens) * rate + ONE_MILLION - 1n) / ONE_MILLION;
}

export function calculateProviderCostMicros(
  pricing: ProviderPricing,
  inputTokens: number,
  outputTokens: number,
): bigint {
  return pricedTokens(tokenCount(inputTokens, 'inputTokens'), pricing.inputMicrosPerMillionTokens)
    + pricedTokens(tokenCount(outputTokens, 'outputTokens'), pricing.outputMicrosPerMillionTokens);
}

export function assertProviderBudget(pricing: ProviderPricing, budget: ProviderBudget): void {
  const maximum = calculateProviderCostMicros(
    pricing,
    budget.estimatedInputTokens,
    budget.maxOutputTokens,
  );
  if (maximum > budget.maxCostMicros) {
    throw new Error('Provider execution exceeds the approved cost budget');
  }
}