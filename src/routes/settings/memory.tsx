/**
 * /settings/memory — M1 Obsidian vault binding surface.
 *
 * Spec: specs/ai-direct-hiring-obsidian-sync.md
 * This page intentionally exposes only:
 *   - bind / revoke controls
 *   - "已绑定 vault + 笔记数 + 标签云" read-only summary
 *   - a desktop-instructions block explaining that the actual scan runs on the desktop client
 *
 * NO raw note content is ever displayed here. Even the summary text is rendered only
 * when the user explicitly opens it, and never sent from this page to the model.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, Eye, EyeOff, RotateCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { SignInPrompt } from "../../components/SignInPrompt";
import { SettingsSkeleton } from "../../components/skeletons/ProtectedPageSkeletons";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { fastifyApi } from "../../lib/fastifyApi";
import { useLocale } from "../../lib/i18n/context";
import { useAuthStatus } from "../../lib/useAuthStatus";

type BindingState = {
  configured: boolean;
  vaultFingerprint: string | null;
  extractorVersion: string | null;
  evidenceVersion: string | null;
  noteCount: number;
  tagCount: number;
  lastSyncAt: string | null;
  updatedAt: string | null;
};

type NotesState = {
  items: Array<{
    notePath: string;
    title: string | null;
    tagsJson: string[] | null;
    linksJson: string[] | null;
    summaryBytes: number;
    sourceBytes: number;
    mtime: string | null;
    size: number;
    updatedAt: string;
  }>;
};

type NoteDetail = {
  notePath: string;
  title: string | null;
  summaryMd: string | null;
  summaryBytes: number;
  sourceBytes: number;
  frontmatterJson: Record<string, unknown> | null;
  mtime: string | null;
  size: number;
};

export const Route = createFileRoute("/settings/memory")({
  component: MemorySettings,
});

const EVIDENCE_VERSION = "2026-08-01";
const EXTRACTOR_VERSION = "2026-08-01";

function MemorySettings() {
  const { t } = useLocale();
  const { isAuthenticated, isLoading } = useAuthStatus();
  const [binding, setBinding] = useState<BindingState | null>(null);
  const [notes, setNotes] = useState<NotesState | null>(null);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [openNote, setOpenNote] = useState<NoteDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [bindingPayload, notesPayload] = await Promise.all([
        fastifyApi.getMemoryBinding(),
        fastifyApi.getMemoryNotes(50).catch(() => ({ items: [] })),
      ]);
      setBinding(bindingPayload);
      setNotes(notesPayload);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t("settings.memory.load_failed"));
    }
  }, [t]);

  useEffect(() => {
    if (isAuthenticated) {
      void refresh();
    }
  }, [isAuthenticated, refresh]);

  const topTags = useMemo(() => {
    if (!notes) return [] as string[];
    const counts = new Map<string, number>();
    for (const note of notes.items) {
      if (!note.tagsJson) continue;
      try {
        const tags = Array.isArray(note.tagsJson) ? note.tagsJson : [];
        for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      } catch {
        // ignore malformed frontmatter
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 16)
      .map(([tag]) => tag);
  }, [notes]);

  const handleBind = async () => {
    setBusy(true);
    try {
      // M1: the desktop client posts the actual vaultFingerprint (computed locally).
      // The web UI uses a placeholder fingerprint so users can see the contract end-to-end
      // before the desktop client ships. The desktop-side bind will overwrite this row.
      const placeholder = await generatePlaceholderFingerprint();
      await fastifyApi.bindMemoryVault({
        vaultFingerprint: placeholder,
        extractorVersion: EXTRACTOR_VERSION,
        evidenceVersion: EVIDENCE_VERSION,
      });
      toast.success(t("settings.memory.placeholder_created"));
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("settings.memory.bind_failed"));
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async () => {
    if (!binding?.configured) return;
    if (!window.confirm(t("settings.memory.revoke_confirm"))) return;
    setBusy(true);
    try {
      await fastifyApi.revokeMemoryVault();
      setOpenPath(null);
      setOpenNote(null);
      await refresh();
      toast.success(t("settings.memory.revoked"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("settings.memory.revoke_failed"));
    } finally {
      setBusy(false);
    }
  };

  const openNoteSummary = async (path: string) => {
    setOpenPath(path);
    try {
      const detail = await fastifyApi.getMemoryNote(path);
      setOpenNote(detail);
    } catch (error) {
      setOpenNote(null);
      toast.error(
        error instanceof Error ? error.message : t("settings.memory.summary_load_failed"),
      );
    }
  };

  if (isLoading) {
    return <SettingsSkeleton />;
  }

  if (!isAuthenticated) {
    return <SignInPrompt title={t("settings.memory.sign_in_title")} />;
  }

  if (loadError) {
    return (
      <main className="section">
        <Card>
          <CardHeader>
            <CardTitle>{t("settings.memory.title")}</CardTitle>
            <CardDescription>{loadError}</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  if (!binding) {
    return (
      <main className="section">
        <Card>
          <CardHeader>
            <CardTitle>{t("settings.memory.title")}</CardTitle>
            <CardDescription>{t("settings.memory.loading_status")}</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  return (
    <main className="section">
      <div className="section-header">
        <div>
          <h1 className="section-title">{t("settings.memory.title")}</h1>
          <p className="section-subtitle">{t("settings.memory.subtitle")}</p>
        </div>
        <Link to="/settings" search={{ view: undefined }} className="text-sm">
          {t("settings.memory.back")}
        </Link>
      </div>

      <Card className="memory-card">
        <CardHeader>
          <CardTitle>{t("settings.memory.binding_status")}</CardTitle>
          <CardDescription>
            {binding.configured
              ? t("settings.memory.configured_description")
              : t("settings.memory.unconfigured_description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="memory-status">
          <div className="memory-row">
            <span className="memory-label">{t("settings.memory.configured")}</span>
            <span className="memory-value">
              {binding.configured ? t("settings.memory.yes") : t("settings.memory.no")}
            </span>
          </div>
          <div className="memory-row">
            <span className="memory-label">{t("settings.memory.vault_fingerprint")}</span>
            <code className="memory-mono">{binding.vaultFingerprint ?? "—"}</code>
          </div>
          <div className="memory-row">
            <span className="memory-label">{t("settings.memory.extractor_version")}</span>
            <span className="memory-value">{binding.extractorVersion ?? "—"}</span>
          </div>
          <div className="memory-row">
            <span className="memory-label">{t("settings.memory.evidence_version")}</span>
            <span className="memory-value">{binding.evidenceVersion ?? "—"}</span>
          </div>
          <div className="memory-row">
            <span className="memory-label">{t("settings.memory.note_count")}</span>
            <span className="memory-value">{binding.noteCount}</span>
          </div>
          <div className="memory-row">
            <span className="memory-label">{t("settings.memory.tag_count")}</span>
            <span className="memory-value">{binding.tagCount}</span>
          </div>
          <div className="memory-row">
            <span className="memory-label">{t("settings.memory.last_sync")}</span>
            <span className="memory-value">{binding.lastSyncAt ?? "—"}</span>
          </div>
          <div className="memory-actions">
            {binding.configured ? (
              <>
                <Button variant="outline" disabled={busy} onClick={() => void refresh()}>
                  <RotateCw className="mr-2 h-4 w-4" /> {t("settings.memory.refresh")}
                </Button>
                <Button variant="destructive" disabled={busy} onClick={handleRevoke}>
                  <Trash2 className="mr-2 h-4 w-4" /> {t("settings.memory.revoke")}
                </Button>
              </>
            ) : (
              <Button disabled={busy} onClick={handleBind}>
                <BookOpen className="mr-2 h-4 w-4" /> {t("settings.memory.create_placeholder")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {binding.configured && (
        <Card className="memory-card">
          <CardHeader>
            <CardTitle>{t("settings.memory.recent_summaries")}</CardTitle>
            <CardDescription>{t("settings.memory.recent_summaries_description")}</CardDescription>
          </CardHeader>
          <CardContent>
            {topTags.length > 0 && (
              <div className="memory-tags">
                {topTags.map((tag) => (
                  <Badge key={tag} variant="compact">
                    #{tag}
                  </Badge>
                ))}
              </div>
            )}
            <ul className="memory-note-list">
              {(notes?.items ?? []).map((note) => (
                <li key={note.notePath} className="memory-note-row">
                  <div className="memory-note-meta">
                    <div className="memory-note-title">{note.title ?? note.notePath}</div>
                    <div className="memory-note-path">{note.notePath}</div>
                  </div>
                  <div className="memory-note-side">
                    <span className="memory-note-size">
                      {note.summaryBytes}B / {note.sourceBytes}B
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void openNoteSummary(note.notePath)}
                    >
                      {openPath === note.notePath ? (
                        <EyeOff className="mr-1 h-4 w-4" />
                      ) : (
                        <Eye className="mr-1 h-4 w-4" />
                      )}
                      {t("settings.memory.summary")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            {openNote && (
              <div className="memory-summary">
                <div className="memory-summary-title">{openNote.title ?? openNote.notePath}</div>
                <pre className="memory-summary-pre">
                  {openNote.summaryMd ?? t("settings.memory.no_summary")}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="memory-card">
        <CardHeader>
          <CardTitle>{t("settings.memory.next_steps")}</CardTitle>
          <CardDescription>
            {t("settings.memory.next_steps_description", {
              path: "specs/ai-direct-hiring-obsidian-sync.md",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="memory-bullets">
            <li>{t("settings.memory.step_one", { path: "/api/v1/memory/obsidian/sync" })}</li>
            <li>{t("settings.memory.step_two")}</li>
            <li>{t("settings.memory.step_three")}</li>
            <li>{t("settings.memory.step_four")}</li>
          </ul>
        </CardContent>
      </Card>
    </main>
  );
}

async function generatePlaceholderFingerprint(): Promise<string> {
  const random = crypto.getRandomValues(new Uint8Array(32));
  let hex = "";
  for (const byte of random) hex += byte.toString(16).padStart(2, "0");
  return hex;
}
