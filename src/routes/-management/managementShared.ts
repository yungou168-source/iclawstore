import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Locale } from "../../lib/i18n/config";
import { getUserFacingConvexError } from "../../lib/convexError";

export const SKILL_AUDIT_LOG_LIMIT = 10;
export const USER_BAN_REASON_MAX_LENGTH = 500;

export type ManagementUserListResult = FunctionReturnType<typeof api.users.list>;
export type SkillBySlugResult = FunctionReturnType<typeof api.skills.getBySlugForStaff>;
export type PluginByNameResult = FunctionReturnType<typeof api.packages.getByNameForStaff>;
export type RecentVersionEntry = FunctionReturnType<typeof api.skills.listRecentVersions>[number];
export type ReportedSkillEntry = FunctionReturnType<typeof api.skills.listReportedSkills>[number];
export type DuplicateCandidateEntry = FunctionReturnType<
  typeof api.skills.listDuplicateCandidates
>[number];
export type ManagementUserSummary = NonNullable<NonNullable<SkillBySlugResult>["overrideReviewer"]>;

export type PublisherAbuseReviewDashboard = FunctionReturnType<
  typeof api.publisherAbuse.listReviewDashboard
>;
export type PublisherAbuseReviewDetail = FunctionReturnType<
  typeof api.publisherAbuse.getReviewNominationDetail
>;
export type PublisherAbuseReviewItem = PublisherAbuseReviewDashboard["pendingItems"][number];
export type PublisherAbuseReviewScore = NonNullable<PublisherAbuseReviewItem["latestScore"]>;
export type PublisherAbuseTab = "potential_ban_candidate" | "review" | "all_pending" | "resolved";

export type ManagementView =
  | "overview"
  | "abuse"
  | "reports"
  | "users"
  | "publishers"
  | "skills"
  | "plugins"
  | "duplicates"
  | "recent"
  | "organizations"
  | "templates"
  | "audit"
  | "system"
  | "employees"
  | "costs"
  | "approvals"
  | "settings";

export type ManagementOwnerOption = {
  userId: Id<"users">;
  label: string;
};

export type ManagementTranslator = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

export function resolveOwnerParam(
  handle: string | null | undefined,
  ownerId?: Id<"users"> | Id<"publishers">,
) {
  return handle?.trim().toLowerCase() || (ownerId ? String(ownerId) : "unknown");
}

export function formatTimestamp(value: number, locale?: Locale) {
  return new Date(value).toLocaleString(locale);
}

export function formatShortTimestamp(value: number, locale?: Locale) {
  return new Date(value).toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatWholeNumber(value: number | null | undefined, locale?: Locale) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(locale).format(Math.round(value));
}

export function formatRatio(value: number | null | undefined, locale?: Locale) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: value < 1 ? 2 : 1,
    minimumFractionDigits: value < 1 ? 2 : 0,
  }).format(value);
}

export function formatScore(value: number, locale?: Locale) {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value);
}

export function formatMutationError(error: unknown, fallback = "Request failed.") {
  return getUserFacingConvexError(error, fallback);
}

export function formatManualOverrideState(
  override:
    | {
        verdict: string;
        note: string;
        reviewerUserId: string;
        updatedAt: number;
      }
    | null
    | undefined,
  reviewer?: ManagementUserSummary | null,
  t?: ManagementTranslator,
  locale?: Locale,
) {
  if (!override) return t?.("management.skills.no_override") ?? "No override.";
  const verdict = formatVerdictLabel(override.verdict, t);
  const reviewerLabel = formatManagementUserLabel(reviewer, override.reviewerUserId, t);
  const time = formatTimestamp(override.updatedAt, locale);
  return (
    t?.("management.skills.override_state", {
      verdict,
      reviewer: reviewerLabel,
      time,
      note: override.note,
    }) ?? `${verdict} · reviewer ${reviewerLabel} · updated ${time} · ${override.note}`
  );
}

export function formatManagementUserLabel(
  user: ManagementUserSummary | null | undefined,
  fallbackId?: string | null,
  t?: ManagementTranslator,
) {
  if (user?.handle?.trim()) return `@${user.handle.trim()}`;
  if (user?.displayName?.trim()) return user.displayName.trim();
  if (user?.name?.trim()) return user.name.trim();
  if (fallbackId?.trim()) return fallbackId.trim();
  return t?.("management.unknown_user") ?? "unknown user";
}

export function formatAuditActionLabel(
  action: string,
  metadata?: unknown,
  t?: ManagementTranslator,
) {
  const record = asAuditMetadataRecord(metadata);
  if (action === "skill.manual_override.set") {
    const verdict = typeof record?.verdict === "string" ? record.verdict : "unknown";
    return (
      t?.("management.audit.override_set", { verdict: formatVerdictLabel(verdict, t) }) ??
      `Override set to ${formatVerdictLabel(verdict)}`
    );
  }
  if (action === "skill.manual_override.clear") {
    return t?.("management.audit.override_cleared") ?? "Override cleared";
  }
  if (action === "skill.owner.change") {
    return t?.("management.audit.owner_changed") ?? "Owner changed";
  }
  if (action === "skill.duplicate.set") {
    return t?.("management.audit.duplicate_set") ?? "Duplicate target set";
  }
  if (action === "skill.duplicate.clear") {
    return t?.("management.audit.duplicate_cleared") ?? "Duplicate target cleared";
  }
  if (action === "skill.auto_hide") {
    return t?.("management.audit.auto_hidden") ?? "Skill auto-hidden";
  }
  if (action === "skill.hard_delete") {
    return t?.("management.audit.hard_deleted") ?? "Skill hard-deleted";
  }
  if (action.startsWith("skill.transfer.")) {
    const transferAction = action.slice("skill.transfer.".length).replaceAll("_", " ");
    return t?.("management.audit.transfer", { action: transferAction }) ?? `Transfer ${transferAction}`;
  }
  if (action.startsWith("skill.")) {
    return action.slice("skill.".length).replaceAll(".", " ").replaceAll("_", " ");
  }
  return action.replaceAll(".", " ").replaceAll("_", " ");
}

export function formatAuditMetadataSummary(
  action: string,
  metadata?: unknown,
  t?: ManagementTranslator,
) {
  const record = asAuditMetadataRecord(metadata);
  if (!record) return null;

  if (action === "skill.manual_override.set") {
    const note = typeof record.note === "string" ? record.note.trim() : "";
    if (note) return note;
    const previousVerdict =
      typeof record.previousVerdict === "string" ? record.previousVerdict : null;
    return previousVerdict
      ? (t?.("management.audit.previous_verdict", {
          verdict: formatVerdictLabel(previousVerdict, t),
        }) ?? `Previous verdict: ${formatVerdictLabel(previousVerdict)}`)
      : null;
  }

  if (action === "skill.manual_override.clear") {
    const note = typeof record.note === "string" ? record.note.trim() : "";
    if (note) return note;
    const previousVerdict =
      typeof record.previousVerdict === "string" ? record.previousVerdict : null;
    return previousVerdict
      ? (t?.("management.audit.previous_override_verdict", {
          verdict: formatVerdictLabel(previousVerdict, t),
        }) ?? `Previous override verdict: ${formatVerdictLabel(previousVerdict)}`)
      : null;
  }

  if (action === "skill.owner.change") {
    const from = typeof record.from === "string" ? record.from : null;
    const to = typeof record.to === "string" ? record.to : null;
    if (from || to) {
      const fromLabel = from ?? t?.("management.audit.unknown") ?? "unknown";
      const toLabel = to ?? t?.("management.audit.unknown") ?? "unknown";
      return (
        t?.("management.audit.owner_from_to", { from: fromLabel, to: toLabel }) ??
        `from ${fromLabel} to ${toLabel}`
      );
    }
  }

  if (action === "skill.duplicate.set") {
    return typeof record.canonicalSlug === "string"
      ? (t?.("management.audit.canonical_skill", { slug: record.canonicalSlug }) ??
          `Canonical skill: ${record.canonicalSlug}`)
      : null;
  }

  if (action === "skill.duplicate.clear") {
    return t?.("management.audit.canonical_cleared") ?? "Canonical skill cleared.";
  }

  if (action === "skill.auto_hide") {
    return typeof record.reportCount === "number"
      ? (t?.("management.audit.active_reports", { count: record.reportCount }) ??
          `${record.reportCount} active reports`)
      : null;
  }

  if (action === "skill.hard_delete") {
    return typeof record.slug === "string"
      ? (t?.("management.audit.deleted_slug", { slug: record.slug }) ??
          `Deleted slug: ${record.slug}`)
      : null;
  }

  if (typeof record.note === "string" && record.note.trim()) {
    return record.note.trim();
  }
  if (typeof record.reason === "string" && record.reason.trim()) {
    return record.reason.trim();
  }
  return null;
}

function asAuditMetadataRecord(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  return metadata as Record<string, unknown>;
}

function formatVerdictLabel(verdict: string, t?: ManagementTranslator) {
  return verdict === "clean" ? (t?.("management.audit.verdict_okay") ?? "okay") : verdict;
}
