import { Link } from "@tanstack/react-router";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  getSkillBadges,
  isSkillDeprecated,
  isSkillHighlighted,
  isSkillOfficial,
} from "../../lib/badges";
import { useLocale } from "../../lib/i18n/context";
import {
  formatAuditActionLabel,
  formatAuditMetadataSummary,
  formatManagementUserLabel,
  formatManualOverrideState,
  formatTimestamp,
  resolveOwnerParam,
  SKILL_AUDIT_LOG_LIMIT,
  type ManagementOwnerOption,
  type ManagementUserListResult,
  type SkillBySlugResult,
} from "./managementShared";

export function SkillsPage({
  admin,
  currentUserId,
  ownerOptions,
  ownerSearch,
  ownerSummary,
  ownerUsers,
  selectedDuplicate,
  selectedOwner,
  selectedSkill,
  selectedSlug,
  skillOverrideNote,
  skillSearch,
  staff,
  onApplySkillOverride,
  onBanUser,
  onChangeOwner,
  onChangeOwnerSearch,
  onChangeSelectedDuplicate,
  onChangeSelectedOwner,
  onChangeSkillOverrideNote,
  onChangeSkillSearch,
  onClearSkillOverride,
  onHardDeleteSkill,
  onManageSkill,
  onSetBatch,
  onSetDeprecatedBadge,
  onSetDuplicate,
  onSetOfficialBadge,
  onToggleSkillHidden,
}: {
  admin: boolean;
  currentUserId: Id<"users"> | null;
  ownerOptions: ManagementOwnerOption[];
  ownerSearch: string;
  ownerSummary: string;
  ownerUsers: ManagementUserListResult["items"];
  selectedDuplicate: string;
  selectedOwner: Id<"users"> | "";
  selectedSkill: SkillBySlugResult | undefined;
  selectedSlug: string | undefined;
  skillOverrideNote: string;
  skillSearch: string;
  staff: boolean;
  onApplySkillOverride: () => void;
  onBanUser: (userId: Id<"users">, label: string) => void;
  onChangeOwner: (skillId: Id<"skills">, ownerUserId: Id<"users">) => void;
  onChangeOwnerSearch: (value: string) => void;
  onChangeSelectedDuplicate: (value: string) => void;
  onChangeSelectedOwner: (value: Id<"users"> | "") => void;
  onChangeSkillOverrideNote: (value: string) => void;
  onChangeSkillSearch: (value: string) => void;
  onClearSkillOverride: () => void;
  onHardDeleteSkill: (skill: Doc<"skills">) => void;
  onManageSkill: () => void;
  onSetBatch: (skillId: Id<"skills">, batch: "highlighted" | undefined) => void;
  onSetDeprecatedBadge: (skillId: Id<"skills">, deprecated: boolean) => void;
  onSetDuplicate: (skillId: Id<"skills">, canonicalSlug: string | undefined) => void;
  onSetOfficialBadge: (skillId: Id<"skills">, official: boolean) => void;
  onToggleSkillHidden: (skill: Doc<"skills">) => void;
}) {
  const { locale, t } = useLocale();
  return (
    <div className="management-view">
      <h2 className="section-title text-[1.2rem] m-0">{t("management.skills.title")}</h2>
      <p className="section-subtitle m-0 mt-1">{t("management.skills.subtitle")}</p>
      <div className="management-controls">
        <div className="management-control management-search">
          <span className="mono">{t("management.skills.skill")}</span>
          <input
            type="search"
            placeholder="skill-slug"
            value={skillSearch}
            onChange={(event) => onChangeSkillSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onManageSkill();
              }
            }}
          />
        </div>
        <Button type="button" onClick={onManageSkill} disabled={!skillSearch.trim()}>
          {t("management.manage")}
        </Button>
      </div>
      {selectedSlug ? (
        <div className="section-subtitle mt-2">
          {t("management.skills.managing", { name: selectedSlug })} ·{" "}
          <Link
            to="/management"
            search={{
              view: "skills",
              skill: undefined,
              plugin: undefined,
            }}
          >
            {t("management.clear_selection")}
          </Link>
        </div>
      ) : null}
      <div className="management-list">
        {!selectedSlug ? (
          <div className="management-empty">{t("management.skills.enter")}</div>
        ) : selectedSkill === undefined ? (
          <div className="management-empty">{t("management.skills.loading")}</div>
        ) : !selectedSkill?.skill ? (
          <div className="management-empty">
            {t("management.skills.not_found", { name: selectedSlug })}
          </div>
        ) : (
          (() => {
            const { skill, latestVersion, owner, canonical, overrideReviewer, auditLogs } =
              selectedSkill;
            const ownerParam = resolveOwnerParam(
              owner?.handle ?? null,
              owner?._id ?? skill.ownerUserId,
            );
            const moderationStatus =
              skill.moderationStatus ?? (skill.softDeletedAt ? "hidden" : "active");
            const isHighlighted = isSkillHighlighted(skill);
            const isOfficial = isSkillOfficial(skill);
            const isDeprecated = isSkillDeprecated(skill);
            const badges = getSkillBadges(skill);
            const ownerUserId = skill.ownerUserId ?? null;
            const ownerHandle = owner?.handle ?? owner?.displayName ?? "user";
            const ownerRecord = ownerUsers.find((user) => user._id === ownerUserId);
            const isOwnerAdmin = ownerRecord?.role === "admin";
            const canBanOwner =
              staff && ownerUserId && ownerUserId !== currentUserId && (admin || !isOwnerAdmin);

            return (
              <div key={skill._id} className="management-item management-item-detail">
                <div className="management-item-main">
                  <Link to="/$owner/$slug" params={{ owner: ownerParam, slug: skill.slug }}>
                    {skill.displayName}
                  </Link>
                  <div className="section-subtitle m-0">
                    @{owner?.handle ?? owner?.displayName ?? "user"} · v
                    {latestVersion?.version ?? "—"} ·{" "}
                    {t("management.skills.updated", {
                      time: formatTimestamp(skill.updatedAt, locale),
                    })}{" "}
                    · {moderationStatus}
                    {badges.length ? ` · ${badges.join(", ").toLowerCase()}` : ""}
                  </div>
                  {skill.moderationFlags?.length ? (
                    <div className="management-tags">
                      {skill.moderationFlags.map((flag: string) => (
                        <Badge key={flag}>{flag}</Badge>
                      ))}
                    </div>
                  ) : null}
                  <div className="management-sublist">
                    <div className="section-subtitle m-0">
                      {t("management.skills.manual_overrides")}
                    </div>
                    <section className="management-override-panel">
                      <div className="management-report-item">
                        <span className="management-report-meta">
                          {t("management.skills.current_override")}
                        </span>
                        <span>
                          {formatManualOverrideState(
                            skill.manualOverride,
                            overrideReviewer,
                            t,
                            locale,
                          )}
                        </span>
                      </div>
                      <div className="management-report-item">
                        <span className="management-report-meta">
                          {t("management.skills.latest_version")}
                        </span>
                        <span>
                          {latestVersion
                            ? `v${latestVersion.version}`
                            : t("management.skills.no_version")}
                        </span>
                      </div>
                      <div className="management-report-item">
                        <span className="management-report-meta">
                          {t("management.skills.behavior")}
                        </span>
                        <span>{t("management.skills.behavior_desc")}</span>
                      </div>
                      <textarea
                        className="form-input management-textarea"
                        rows={4}
                        placeholder={
                          skill.manualOverride
                            ? t("management.skills.note_update")
                            : t("management.skills.note_mark")
                        }
                        value={skillOverrideNote}
                        onChange={(event) => onChangeSkillOverrideNote(event.target.value)}
                      />
                      <div className="management-actions management-actions-start">
                        <Button
                          className="management-action-btn"
                          type="button"
                          disabled={!skillOverrideNote.trim()}
                          onClick={onApplySkillOverride}
                        >
                          {skill.manualOverride
                            ? t("management.skills.update_override")
                            : t("management.skills.mark_okay")}
                        </Button>
                        {skill.manualOverride ? (
                          <Button
                            className="management-action-btn"
                            type="button"
                            disabled={!skillOverrideNote.trim()}
                            onClick={onClearSkillOverride}
                          >
                            {t("management.skills.clear_override")}
                          </Button>
                        ) : null}
                      </div>
                    </section>
                  </div>
                  <div className="management-sublist">
                    <div className="section-subtitle m-0">
                      {t("management.skills.recent_audit")}
                    </div>
                    <section className="management-override-panel management-audit-panel">
                      <div className="management-report-item">
                        <span className="management-report-meta">
                          {t("management.skills.window")}
                        </span>
                        <span>
                          {t("management.skills.last_entries", { count: SKILL_AUDIT_LOG_LIMIT })}
                        </span>
                      </div>
                      {auditLogs.length === 0 ? (
                        <div className="section-subtitle m-0">
                          {t("management.skills.no_audit")}
                        </div>
                      ) : (
                        <div className="management-audit-list">
                          {auditLogs.map((entry) => {
                            const auditSummary = formatAuditMetadataSummary(
                              entry.action,
                              entry.metadata,
                              t,
                            );
                            return (
                              <div key={entry._id} className="management-audit-item">
                                <div className="management-report-item">
                                  <span className="management-report-meta">
                                    {formatTimestamp(entry.createdAt, locale)} ·{" "}
                                    {formatManagementUserLabel(entry.actor, undefined, t)}
                                  </span>
                                  <span>
                                    {formatAuditActionLabel(entry.action, entry.metadata, t)}
                                  </span>
                                </div>
                                {auditSummary ? (
                                  <div className="section-subtitle management-audit-summary">
                                    {auditSummary}
                                  </div>
                                ) : null}
                                {entry.metadata ? (
                                  <details className="management-audit-details">
                                    <summary>{t("management.skills.metadata")}</summary>
                                    <pre className="management-audit-json">
                                      {JSON.stringify(entry.metadata, null, 2)}
                                    </pre>
                                  </details>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  </div>
                  <div className="management-tool-grid">
                    <label className="management-control management-control-stack">
                      <span className="mono">{t("management.skills.duplicate_of")}</span>
                      <input
                        className="management-field"
                        value={selectedDuplicate}
                        onChange={(event) => onChangeSelectedDuplicate(event.target.value)}
                        placeholder={
                          canonical?.skill?.slug ?? t("management.skills.canonical_slug")
                        }
                      />
                    </label>
                    <div className="management-control management-control-stack">
                      <span className="mono">{t("management.skills.duplicate_action")}</span>
                      <Button
                        className="management-action-btn"
                        type="button"
                        onClick={() =>
                          onSetDuplicate(skill._id, selectedDuplicate.trim() || undefined)
                        }
                      >
                        {t("management.skills.set_duplicate")}
                      </Button>
                    </div>
                    {admin ? (
                      <>
                        <label className="management-control management-control-stack">
                          <span className="mono">{t("management.skills.owner_search")}</span>
                          <input
                            className="management-field"
                            type="search"
                            placeholder={t("management.skills.search_owner")}
                            value={ownerSearch}
                            onChange={(event) => onChangeOwnerSearch(event.target.value)}
                          />
                          <span className="management-count">{ownerSummary}</span>
                        </label>
                        <label className="management-control management-control-stack">
                          <span className="mono">{t("management.skills.owner")}</span>
                          <Select
                            value={selectedOwner}
                            onValueChange={(value) => {
                              const option = ownerOptions.find(
                                (ownerOption) => ownerOption.userId === value,
                              );
                              if (option) onChangeSelectedOwner(option.userId);
                            }}
                          >
                            <SelectTrigger className="management-field">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ownerOptions.map((user) => (
                                <SelectItem key={user.userId} value={user.userId}>
                                  {user.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </label>
                        <div className="management-control management-control-stack">
                          <span className="mono">{t("management.skills.owner_action")}</span>
                          <Button
                            className="management-action-btn"
                            type="button"
                            onClick={() => {
                              if (!selectedOwner) return;
                              onChangeOwner(skill._id, selectedOwner);
                            }}
                          >
                            {t("management.skills.change_owner")}
                          </Button>
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="management-actions management-action-grid">
                  <Button asChild className="management-action-btn">
                    <Link to="/$owner/$slug" params={{ owner: ownerParam, slug: skill.slug }}>
                      {t("management.view")}
                    </Link>
                  </Button>
                  <Button
                    className="management-action-btn"
                    type="button"
                    onClick={() => onToggleSkillHidden(skill)}
                  >
                    {skill.softDeletedAt ? t("management.restore") : t("management.hide")}
                  </Button>
                  <Button
                    className="management-action-btn"
                    type="button"
                    onClick={() => onSetBatch(skill._id, isHighlighted ? undefined : "highlighted")}
                  >
                    {isHighlighted ? t("management.unhighlight") : t("management.highlight")}
                  </Button>
                  {admin ? (
                    <Button
                      className="management-action-btn"
                      type="button"
                      variant="destructive"
                      onClick={() => onHardDeleteSkill(skill)}
                    >
                      {t("management.hard_delete")}
                    </Button>
                  ) : null}
                  {staff ? (
                    <Button
                      className="management-action-btn"
                      type="button"
                      variant="destructive"
                      disabled={!canBanOwner}
                      onClick={() => {
                        if (!ownerUserId || ownerUserId === currentUserId) return;
                        onBanUser(ownerUserId, `@${ownerHandle}`);
                      }}
                    >
                      {t("management.ban_user")}
                    </Button>
                  ) : null}
                  {admin ? (
                    <>
                      <Button
                        className="management-action-btn"
                        type="button"
                        onClick={() => onSetOfficialBadge(skill._id, !isOfficial)}
                      >
                        {isOfficial
                          ? t("management.skills.remove_official")
                          : t("management.skills.mark_official")}
                      </Button>
                      <Button
                        className="management-action-btn"
                        type="button"
                        onClick={() => onSetDeprecatedBadge(skill._id, !isDeprecated)}
                      >
                        {isDeprecated
                          ? t("management.skills.remove_deprecated")
                          : t("management.skills.mark_deprecated")}
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })()
        )}
      </div>
    </div>
  );
}
