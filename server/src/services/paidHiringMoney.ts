import { AiDirectHiringError, ErrorCodes } from "./aiDirectErrors.js";

export const PAID_HIRING_CURRENCY = "CNY" as const;
export const PLATFORM_FEE_PERCENT = 20 as const;

export type PaidHiringSplit = {
  grossAmountFen: bigint;
  platformFeeFen: bigint;
  developerPayableFen: bigint;
};

export function parseNonNegativeCnyFen(value: unknown): bigint {
  const normalized = typeof value === "number" ? String(value) : value;
  if (typeof normalized !== "string" || !/^\d+$/.test(normalized)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "amountFen 必须是非负整数分");
  }
  const amount = BigInt(normalized);
  if (amount > 100_000_000n) {
    throw new AiDirectHiringError(
      ErrorCodes.VALIDATION_ERROR,
      "amountFen 必须在 0 到 100000000 分之间",
    );
  }
  return amount;
}

export function parseCnyFen(value: unknown): bigint {
  const normalized = typeof value === "number" ? String(value) : value;
  if (typeof normalized !== "string" || !/^\d+$/.test(normalized)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "amountFen 必须是正整数分");
  }
  const amount = BigInt(normalized);
  if (amount <= 0n || amount > 100_000_000n) {
    throw new AiDirectHiringError(
      ErrorCodes.VALIDATION_ERROR,
      "amountFen 必须在 1 到 100000000 分之间",
    );
  }
  return amount;
}

export function splitPaidHiringAmount(grossAmountFen: bigint): PaidHiringSplit {
  if (grossAmountFen <= 0n) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "支付金额必须为正整数分");
  }
  const platformFeeFen = (grossAmountFen * 20n + 50n) / 100n;
  const developerPayableFen = grossAmountFen - platformFeeFen;
  return { grossAmountFen, platformFeeFen, developerPayableFen };
}

export function fenToCnyAmount(amountFen: bigint): string {
  const yuan = amountFen / 100n;
  const fen = String(amountFen % 100n).padStart(2, "0");
  return `${yuan}.${fen}`;
}

export function cnyAmountToFen(value: string): bigint {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "支付宝金额格式无效");
  }
  const [yuan, fraction = ""] = value.split(".");
  return BigInt(yuan) * 100n + BigInt(fraction.padEnd(2, "0"));
}
