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
import { SignInPrompt } from '../../components/SignInPrompt';
import { SettingsSkeleton } from '../../components/skeletons/ProtectedPageSkeletons';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { useAuthStatus } from '../../lib/useAuthStatus';
import { fastifyApi } from '../../lib/fastifyApi';

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
  frontmatterJson: string | null;
  mtime: string | null;
  size: number;
};

export const Route = createFileRoute("/settings/memory")({
  component: MemorySettings,
});

const EVIDENCE_VERSION = "2026-08-01";
const EXTRACTOR_VERSION = "2026-08-01";

function MemorySettings() {
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
      setLoadError(error instanceof Error ? error.message : "加载失败");
    }
  }, []);

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
      toast.success("已创建 vault 绑定占位。请在桌面端完成实际扫描。");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "绑定失败");
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async () => {
    if (!binding?.configured) return;
    if (!window.confirm("撤销绑定将清空所有已上传的摘要。继续？")) return;
    setBusy(true);
    try {
      await fastifyApi.revokeMemoryVault();
      setOpenPath(null);
      setOpenNote(null);
      await refresh();
      toast.success("绑定已撤销。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "撤销失败");
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
      toast.error(error instanceof Error ? error.message : "摘要读取失败");
    }
  };

  if (isLoading) {
    return <SettingsSkeleton />;
  }

  if (!isAuthenticated) {
    return <SignInPrompt title="登录后管理 Obsidian 记忆绑定" />;
  }

  if (loadError) {
    return (
      <main className="section">
        <Card>
          <CardHeader>
            <CardTitle>记忆绑定</CardTitle>
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
            <CardTitle>Obsidian 记忆绑定</CardTitle>
            <CardDescription>正在加载绑定状态…</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  return (
    <main className="section">
      <div className="section-header">
        <div>
          <h1 className="section-title">Obsidian 记忆绑定</h1>
          <p className="section-subtitle">
            将本机 Obsidian 库的脱敏摘要与本平台同步。原文、正文、附件本地保留，
            仅标签、标题与 ≤ 20% 摘要会上传。
          </p>
        </div>
        <Link to="/settings" search={{ view: undefined }} className="text-sm">
          返回设置
        </Link>
      </div>

      <Card className="memory-card">
        <CardHeader>
          <CardTitle>绑定状态</CardTitle>
          <CardDescription>
            {binding.configured
              ? "当前已绑定一个本地 vault。原文不会离开你的设备。"
              : "尚未绑定任何 vault。绑定后可在桌面端运行扫描。"}
          </CardDescription>
        </CardHeader>
        <CardContent className="memory-status">
          <div className="memory-row">
            <span className="memory-label">已绑定</span>
            <span className="memory-value">
              {binding.configured ? "是" : "否"}
            </span>
          </div>
          <div className="memory-row">
            <span className="memory-label">Vault 指纹</span>
            <code className="memory-mono">{binding.vaultFingerprint ?? "—"}</code>
          </div>
          <div className="memory-row">
            <span className="memory-label">Extractor 版本</span>
            <span className="memory-value">{binding.extractorVersion ?? "—"}</span>
          </div>
          <div className="memory-row">
            <span className="memory-label">Evidence 版本</span>
            <span className="memory-value">{binding.evidenceVersion ?? "—"}</span>
          </div>
          <div className="memory-row">
            <span className="memory-label">笔记数</span>
            <span className="memory-value">{binding.noteCount}</span>
          </div>
          <div className="memory-row">
            <span className="memory-label">标签数</span>
            <span className="memory-value">{binding.tagCount}</span>
          </div>
          <div className="memory-row">
            <span className="memory-label">最近同步</span>
            <span className="memory-value">{binding.lastSyncAt ?? "—"}</span>
          </div>
          <div className="memory-actions">
            {binding.configured ? (
              <>
                <Button variant="outline" disabled={busy} onClick={() => void refresh()}>
                  <RotateCw className="mr-2 h-4 w-4" /> 刷新
                </Button>
                <Button variant="destructive" disabled={busy} onClick={handleRevoke}>
                  <Trash2 className="mr-2 h-4 w-4" /> 撤销绑定
                </Button>
              </>
            ) : (
              <Button disabled={busy} onClick={handleBind}>
                <BookOpen className="mr-2 h-4 w-4" /> 创建绑定（占位）
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {binding.configured && (
        <Card className="memory-card">
          <CardHeader>
            <CardTitle>最近摘要</CardTitle>
            <CardDescription>
              仅显示摘要元信息；点击展开查看摘要。原文需要回到桌面端。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {topTags.length > 0 && (
              <div className="memory-tags">
                {topTags.map((tag) => (
                  <Badge key={tag} variant="secondary">
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
                      {openPath === note.notePath ? <EyeOff className="mr-1 h-4 w-4" /> : <Eye className="mr-1 h-4 w-4" />}
                      摘要
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            {openNote && (
              <div className="memory-summary">
                <div className="memory-summary-title">{openNote.title ?? openNote.notePath}</div>
                <pre className="memory-summary-pre">{openNote.summaryMd ?? "(无摘要)"}</pre>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="memory-card">
        <CardHeader>
          <CardTitle>下一步</CardTitle>
          <CardDescription>
            M1 范围。Agent 上下文注入、设备控制、跨端实时刷新等能力在 M2+ 解锁。
            完整规格见 <code>specs/ai-direct-hiring-obsidian-sync.md</code>。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="memory-bullets">
            <li>桌面端运行本地抽取器，生成 64 位 hex 指纹与摘要，POST 到 <code>/api/v1/memory/obsidian/sync</code>。</li>
            <li>正文、绝对路径、剪贴板、附件、密钥一概不上传；任何含敏感模式的笔记会被整条丢弃。</li>
            <li>摘要长度不得超过原文 20% 且 ≤ 1MB/批次，单次最多 5000 条。</li>
            <li>撤销绑定后 24 小时内清理所有 digest 记录。</li>
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
