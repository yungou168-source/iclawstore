import { ExternalLink, Link2, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  friendlyLinksApi,
  type FriendlyLinkDto,
  type FriendlyLinkInput,
} from "../../lib/friendlyLinksApi";

const emptyForm: FriendlyLinkInput = {
  label: "",
  url: "https://",
  description: null,
  sortOrder: 100,
  isActive: true,
};

export function FriendlyLinksPage() {
  const [items, setItems] = useState<FriendlyLinkDto[]>([]);
  const [form, setForm] = useState<FriendlyLinkInput>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems((await friendlyLinksApi.listAdmin()).items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "友情链接加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const save = async () => {
    if (!form.label.trim() || !form.url.trim()) return;
    setWorking(true);
    try {
      const input = {
        ...form,
        label: form.label.trim(),
        url: form.url.trim(),
        description: form.description?.trim() || null,
      };
      if (editingId) {
        await friendlyLinksApi.update(editingId, input);
        toast.success("友情链接已更新");
      } else {
        await friendlyLinksApi.create(input);
        toast.success("友情链接已创建");
      }
      resetForm();
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "友情链接保存失败");
    } finally {
      setWorking(false);
    }
  };

  const edit = (item: FriendlyLinkDto) => {
    setEditingId(item.id);
    setForm({
      label: item.label,
      url: item.url,
      description: item.description,
      sortOrder: item.sortOrder,
      isActive: item.isActive,
    });
  };

  const toggle = async (item: FriendlyLinkDto) => {
    setWorking(true);
    try {
      await friendlyLinksApi.update(item.id, {
        label: item.label,
        url: item.url,
        description: item.description,
        sortOrder: item.sortOrder,
        isActive: !item.isActive,
      });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "状态更新失败");
    } finally {
      setWorking(false);
    }
  };

  const remove = async (item: FriendlyLinkDto) => {
    if (!window.confirm(`确认删除友情链接“${item.label}”？`)) return;
    setWorking(true);
    try {
      await friendlyLinksApi.remove(item.id);
      if (editingId === item.id) resetForm();
      toast.success("友情链接已删除");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" aria-hidden="true" />
            友情链接管理
          </CardTitle>
          <CardDescription>管理站点页脚公开展示的链接、顺序和启用状态。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <Label>链接名称</Label>
              <Input
                value={form.label}
                maxLength={80}
                placeholder="例如：AI直聘桌面端"
                onChange={(event) =>
                  setForm((current) => ({ ...current, label: event.target.value }))
                }
              />
            </label>
            <label className="space-y-2">
              <Label>链接地址</Label>
              <Input
                value={form.url}
                maxLength={2048}
                placeholder="https://example.com"
                onChange={(event) =>
                  setForm((current) => ({ ...current, url: event.target.value }))
                }
              />
            </label>
            <label className="space-y-2">
              <Label>链接说明（可选）</Label>
              <Input
                value={form.description ?? ""}
                maxLength={240}
                placeholder="后台备注或链接用途"
                onChange={(event) =>
                  setForm((current) => ({ ...current, description: event.target.value }))
                }
              />
            </label>
            <label className="space-y-2">
              <Label>排序</Label>
              <Input
                type="number"
                min={0}
                max={1_000_000}
                value={form.sortOrder}
                onChange={(event) =>
                  setForm((current) => ({ ...current, sortOrder: Number(event.target.value) }))
                }
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) =>
                setForm((current) => ({ ...current, isActive: event.target.checked }))
              }
            />
            保存后立即在页脚展示
          </label>
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={working || !form.label.trim() || !form.url.trim()}
              onClick={() => void save()}
            >
              {working ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : editingId ? (
                <Pencil className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Plus className="h-4 w-4" aria-hidden="true" />
              )}
              {editingId ? "保存修改" : "新增链接"}
            </Button>
            {editingId ? <Button onClick={resetForm}>取消编辑</Button> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>当前链接</CardTitle>
          <CardDescription>数字越小越靠前；停用后不会出现在公开页脚。</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> 正在加载…
            </p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无友情链接。</p>
          ) : (
            <div className="divide-y rounded-lg border">
              {items.map((item) => (
                <div key={item.id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>{item.label}</strong>
                      <span
                        className={
                          item.isActive
                            ? "text-xs text-emerald-600"
                            : "text-xs text-muted-foreground"
                        }
                      >
                        {item.isActive ? "已启用" : "已停用"}
                      </span>
                      <span className="text-xs text-muted-foreground">排序 {item.sortOrder}</span>
                    </div>
                    <a
                      className="mt-1 flex items-center gap-1 break-all text-sm text-primary"
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {item.url} <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                    </a>
                    {item.description ? (
                      <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={working} onClick={() => void toggle(item)}>
                      {item.isActive ? "停用" : "启用"}
                    </Button>
                    <Button size="sm" onClick={() => edit(item)}>
                      <Pencil className="h-4 w-4" aria-hidden="true" /> 编辑
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={working}
                      onClick={() => void remove(item)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" /> 删除
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
