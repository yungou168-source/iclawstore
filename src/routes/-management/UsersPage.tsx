import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { useLocale } from "../../lib/i18n/context";
import { formatTimestamp, type ManagementUserListResult } from "./managementShared";

type ManagementRole = "admin" | "moderator" | "user";

export function UsersPage({
  currentUserId,
  filteredUsers,
  search,
  summary,
  userEmptyLabel,
  onBanUser,
  onChangeSearch,
  onSetRole,
  onUnbanUser,
}: {
  currentUserId: Id<"users"> | null;
  filteredUsers: ManagementUserListResult["items"];
  search: string;
  summary: string;
  userEmptyLabel: string;
  onBanUser: (userId: Id<"users">, label: string) => void;
  onChangeSearch: (value: string) => void;
  onSetRole: (userId: Id<"users">, role: ManagementRole) => void;
  onUnbanUser: (userId: Id<"users">, label: string) => void;
}) {
  const { locale, t } = useLocale();
  const roleLabel = (role: ManagementRole) => t(`management.users.${role}`);
  return (
    <div className="management-view">
      <h2 className="section-title text-[1.2rem] m-0">{t("management.users")}</h2>
      <p className="section-subtitle m-0 mt-1">{t("management.users.subtitle")}</p>
      <div className="management-controls">
        <div className="management-control management-search">
          <span className="mono">{t("management.filter")}</span>
          <input
            type="search"
            placeholder={t("management.users.search")}
            value={search}
            onChange={(event) => onChangeSearch(event.target.value)}
          />
        </div>
        <div className="management-count">{summary}</div>
      </div>
      <div className="management-list">
        {filteredUsers.length === 0 ? (
          <div className="management-empty">{userEmptyLabel}</div>
        ) : (
          filteredUsers.map((user) => {
            const removed = Boolean(user.deletedAt || user.deactivatedAt);
            const removedAt = user.deactivatedAt ?? user.deletedAt ?? user._creationTime;
            const label = `@${user.handle ?? user.name ?? "user"}`;
            return (
              <div
                key={user._id}
                className={removed ? "management-item is-removed" : "management-item"}
              >
                <div className="management-item-main">
                  <span className="mono">@{user.handle ?? user.name ?? "user"}</span>
                  <div className="management-item-meta">
                    {removed
                      ? user.banReason && user.deletedAt
                        ? t("management.users.banned", {
                            time: formatTimestamp(user.deletedAt, locale),
                            reason: user.banReason,
                          })
                        : t("management.users.deleted", {
                            time: formatTimestamp(removedAt, locale),
                          })
                      : t("management.users.joined", {
                          role: roleLabel(user.role ?? "user"),
                          time: formatTimestamp(user._creationTime, locale),
                        })}
                  </div>
                </div>
                <div className="management-actions">
                  <Select
                    value={user.role ?? "user"}
                    onValueChange={(value) => {
                      if (value === "admin" || value === "moderator" || value === "user") {
                        onSetRole(user._id, value);
                      }
                    }}
                  >
                    <SelectTrigger size="sm" className="w-[130px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">{t("management.users.user")}</SelectItem>
                      <SelectItem value="moderator">{t("management.users.moderator")}</SelectItem>
                      <SelectItem value="admin">{t("management.users.admin")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={user._id === currentUserId}
                    onClick={() => {
                      if (user._id === currentUserId) return;
                      onBanUser(user._id, label);
                    }}
                  >
                    {t("management.ban_user")}
                  </Button>
                  {user.deletedAt && !user.deactivatedAt ? (
                    <Button type="button" onClick={() => onUnbanUser(user._id, label)}>
                      {t("management.unban_user")}
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
