/**
 * Unified error codes for AI Direct Hiring routes.
 * Maps to the stable machine-readable codes defined in
 * specs/ai-direct-hiring-desktop-contract.md §56.
 */
export const ErrorCodes = {
  // Auth / identity
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  // Authorization
  FORBIDDEN_SCOPE: 'FORBIDDEN_SCOPE',
  NOT_FOUND: 'NOT_FOUND',
  // Input validation (client-side mistake, not retryable)
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  // Idempotency
  IDEMPOTENCY_KEY_INVALID: 'IDEMPOTENCY_KEY_INVALID',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  // Agent / version lifecycle
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  // Model resolution
  MODEL_POLICY_NO_MATCH: 'MODEL_POLICY_NO_MATCH',
  // Budget / resource
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  ASSET_LIMIT_EXCEEDED: 'ASSET_LIMIT_EXCEEDED',
  ASSET_TOO_LARGE: 'ASSET_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  ASSET_IN_USE: 'ASSET_IN_USE',
  // Optimistic concurrency
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  PRECONDITION_REQUIRED: 'PRECONDITION_REQUIRED',
  // Template catalog / entitlement
  TEMPLATE_ENTITLEMENT_REQUIRED: 'TEMPLATE_ENTITLEMENT_REQUIRED',
  TEMPLATE_NOT_INSTALLABLE: 'TEMPLATE_NOT_INSTALLABLE',
  // Appearance control
  APPEARANCE_CONTROL_CONFLICT: 'APPEARANCE_CONTROL_CONFLICT',
  // Run state
  RUN_NOT_RECOVERABLE: 'RUN_NOT_RECOVERABLE',
  RUNTIME_CAPABILITY_DISABLED: 'RUNTIME_CAPABILITY_DISABLED',
  // Credential
  CREDENTIAL_INVALID: 'CREDENTIAL_INVALID',
  CREDENTIAL_NOT_FOUND: 'CREDENTIAL_NOT_FOUND',
  // Catalog / model
  MODEL_NOT_APPROVED: 'MODEL_NOT_APPROVED',
  DUPLICATE_ENTRY: 'DUPLICATE_ENTRY',
  // Generic server
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * All business errors thrown from AI Direct Hiring route handlers.
 * The HTTP layer maps these to a stable JSON shape:
 *   { code: string; error: string; details?: unknown }
 */
export class AiDirectHiringError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly httpStatus: number = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AiDirectHiringError';
  }
}

/**
 * Convert any thrown error to the canonical HTTP response shape.
 */
export function errorResponse(err: unknown): { code: string; error: string; details?: unknown } & Record<string, unknown> {
  if (err instanceof AiDirectHiringError) {
    const r: Record<string, unknown> = { code: err.code, error: err.message };
    if (err.details !== undefined) r.details = err.details;
    return r as ReturnType<typeof errorResponse>;
  }
  if (err instanceof Error) {
    return { code: ErrorCodes.INTERNAL_ERROR, error: err.message };
  }
  return { code: ErrorCodes.INTERNAL_ERROR, error: 'An unexpected error occurred' };
}
