export type ProfileIncrementalCursor = Readonly<{
  cursor: string | null;
  watermark: number;
  windowStart: number;
}>;

const isSafeTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export const encodeProfileIncrementalCursor = (value: ProfileIncrementalCursor): string => {
  if (!isSafeTimestamp(value.watermark) || !isSafeTimestamp(value.windowStart)) {
    throw new Error('Profile incremental cursor timestamps must be non-negative safe integers');
  }
  if (value.windowStart > value.watermark) {
    throw new Error('Profile incremental cursor window start cannot exceed its watermark');
  }
  if (value.cursor !== null && (!value.cursor || typeof value.cursor !== 'string')) {
    throw new Error('Profile incremental cursor must be a non-empty string or null');
  }
  return JSON.stringify({
    version: 2,
    cursor: value.cursor,
    watermark: value.watermark,
    windowStart: value.windowStart,
  });
};

export const decodeProfileIncrementalCursor = (value: string | null): ProfileIncrementalCursor | null => {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('version' in parsed) ||
      !('cursor' in parsed) ||
      !('watermark' in parsed) ||
      !('windowStart' in parsed) ||
      parsed.version !== 2 ||
      (parsed.cursor !== null && (typeof parsed.cursor !== 'string' || !parsed.cursor)) ||
      !isSafeTimestamp(parsed.watermark) ||
      !isSafeTimestamp(parsed.windowStart) ||
      parsed.windowStart > parsed.watermark
    ) {
      return null;
    }
    return {
      cursor: parsed.cursor,
      watermark: parsed.watermark,
      windowStart: parsed.windowStart,
    };
  } catch {
    return null;
  }
};

export const profileIncrementalWindowStart = (
  watermark: number,
  overlapMs: number,
): number => {
  if (!isSafeTimestamp(watermark) || !Number.isSafeInteger(overlapMs) || overlapMs < 0) {
    throw new Error('Profile incremental window requires non-negative safe integer timestamps');
  }
  return Math.max(0, watermark - overlapMs);
};