import { Link } from "@tanstack/react-router";
import { Button } from "../../components/ui/button";
import { useLocale } from "../../lib/i18n/context";
import { resolveOwnerParam, type DuplicateCandidateEntry } from "./managementShared";

type DuplicateSkillId = DuplicateCandidateEntry["skill"]["_id"];

export function DuplicatesPage({
  duplicateCandidates,
  onSetDuplicate,
}: {
  duplicateCandidates: DuplicateCandidateEntry[] | undefined;
  onSetDuplicate: (skillId: DuplicateSkillId, canonicalSlug: string) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="management-view">
      <h2 className="section-title text-[1.2rem] m-0">{t("management.duplicate_candidates")}</h2>
      <p className="section-subtitle m-0 mt-1">{t("management.duplicates.subtitle")}</p>
      <div className="management-list">
        {!duplicateCandidates ? (
          <div className="management-empty">{t("management.duplicates.loading")}</div>
        ) : duplicateCandidates.length === 0 ? (
          <div className="management-empty">{t("management.duplicates.empty")}</div>
        ) : (
          duplicateCandidates.map((entry) => (
            <div key={entry.skill._id} className="management-item management-dupe">
              <div className="management-dupe-head">
                <div className="management-item-main">
                  <Link
                    to="/$owner/$slug"
                    params={{
                      owner: resolveOwnerParam(
                        entry.owner?.handle ?? null,
                        entry.owner?._id ?? entry.skill.ownerUserId,
                      ),
                      slug: entry.skill.slug,
                    }}
                  >
                    {entry.skill.displayName}
                  </Link>
                  <div className="section-subtitle m-0">
                    @{entry.owner?.handle ?? entry.owner?.name ?? "user"} · v
                    {entry.latestVersion?.version ?? "—"} ·{" "}
                    <span className="management-fingerprint">
                      {entry.fingerprint ? entry.fingerprint.slice(0, 8) : "—"}
                    </span>
                  </div>
                </div>
                <div className="management-actions">
                  <Button asChild>
                    <Link
                      to="/$owner/$slug"
                      params={{
                        owner: resolveOwnerParam(
                          entry.owner?.handle ?? null,
                          entry.owner?._id ?? entry.skill.ownerUserId,
                        ),
                        slug: entry.skill.slug,
                      }}
                    >
                      {t("management.view")}
                    </Link>
                  </Button>
                </div>
              </div>
              <div className="management-dupe-matches">
                <div className="management-dupe-label">
                  {entry.matches.length === 1
                    ? t("management.duplicates.possible_one")
                    : t("management.duplicates.possible_many")}
                </div>
                {entry.matches.map((match) => (
                  <div key={match.skill._id} className="management-dupe-match">
                    <div className="management-item-main">
                      <strong>{match.skill.displayName}</strong>
                      <div className="section-subtitle m-0">
                        @{match.owner?.handle ?? match.owner?.name ?? "user"} · {match.skill.slug}
                      </div>
                    </div>
                    <div className="management-actions">
                      <Button asChild>
                        <Link
                          to="/$owner/$slug"
                          params={{
                            owner: resolveOwnerParam(
                              match.owner?.handle ?? null,
                              match.owner?._id ?? match.skill.ownerUserId,
                            ),
                            slug: match.skill.slug,
                          }}
                        >
                          {t("management.view")}
                        </Link>
                      </Button>
                      <Button
                        type="button"
                        onClick={() => onSetDuplicate(entry.skill._id, match.skill.slug)}
                      >
                        {t("management.duplicates.mark")}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
