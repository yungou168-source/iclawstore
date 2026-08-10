import { AiDirectHiringError, ErrorCodes } from "./aiDirectErrors.js";

export const interviewRetentionDefaults = {
  bodyRetentionDays: 90,
  modelConsentMode: "organization_default_opt_in",
  attachmentPolicy: "image_pdf_only",
  attachmentMaxBytes: 10 * 1024 * 1024,
} as const;

export type InterviewRetentionPolicy = {
  bodyRetentionDays: number;
  modelConsentMode: "organization_default_opt_in";
  attachmentPolicy: "image_pdf_only";
  attachmentMaxBytes: number;
};

export function normalizeInterviewRetentionPolicy(value: unknown): InterviewRetentionPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiDirectHiringError(ErrorCodes.VALIDATION_ERROR, "面试保留策略必须是对象");
  }
  const policy = value as Record<string, unknown>;
  if (
    policy.bodyRetentionDays !== 90 ||
    policy.modelConsentMode !== "organization_default_opt_in" ||
    policy.attachmentPolicy !== "image_pdf_only" ||
    policy.attachmentMaxBytes !== interviewRetentionDefaults.attachmentMaxBytes
  ) {
    throw new AiDirectHiringError(
      ErrorCodes.VALIDATION_ERROR,
      "当前版本仅支持已批准的 90 天、组织默认模型同意和图片/PDF 附件策略",
    );
  }
  return { ...interviewRetentionDefaults };
}

export function retentionExpiresAt(createdAt: Date = new Date()): Date {
  return new Date(
    createdAt.getTime() + interviewRetentionDefaults.bodyRetentionDays * 24 * 60 * 60 * 1000,
  );
}

export function assertRemoteModelAllowed(input: {
  policy: Pick<InterviewRetentionPolicy, "modelConsentMode">;
  optedOutAt: Date | string | null;
}): void {
  if (input.policy.modelConsentMode !== "organization_default_opt_in" || input.optedOutAt) {
    throw new AiDirectHiringError(
      ErrorCodes.FORBIDDEN_SCOPE,
      "该参与者未同意将面试正文发送至远端模型",
      403,
    );
  }
}
