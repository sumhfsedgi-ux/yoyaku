"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDownIcon, ArrowUpIcon, PencilIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ResponsiveDialogOrSheet } from "@/components/ui/responsive-dialog-or-sheet";
import { EmptyState } from "@/components/ui/empty-state";

export interface MasterListItem {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

export interface MasterListEditorProps {
  title: string;
  nameMaxLength: number;
  items: MasterListItem[];
  onCreate: (input: { name: string }) => Promise<unknown>;
  onRename: (input: { id: string; name: string }) => Promise<unknown>;
  onSetActive: (input: { id: string; active: boolean }) => Promise<unknown>;
  onReorder: (orderedIds: string[]) => Promise<unknown>;
}

/**
 * Generic add/rename/reorder/hide editor for a staff-managed master list -
 * shared by ConcernMaster and AcquisitionSourceMaster (plan §4/§14), kept
 * kind-agnostic via callback props rather than switching on a "kind" enum.
 * Reorder never deletes/recreates rows (they're FK-referenced by
 * VisitRecord/Customer) - it's plain up/down buttons calling onReorder with
 * the full new id order, no drag-and-drop dependency.
 */
export function MasterListEditor({ title, nameMaxLength, items, onCreate, onRename, onSetActive, onReorder }: MasterListEditorProps) {
  const router = useRouter();
  const [dialogState, setDialogState] = useState<{ mode: "create" } | { mode: "rename"; id: string; currentName: string } | null>(null);
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();

  function openCreateDialog() {
    setName("");
    setDialogState({ mode: "create" });
  }

  function openRenameDialog(item: MasterListItem) {
    setName(item.name);
    setDialogState({ mode: "rename", id: item.id, currentName: item.name });
  }

  function handleSaveName() {
    if (!dialogState) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    startTransition(async () => {
      try {
        if (dialogState.mode === "create") {
          await onCreate({ name: trimmed });
          toast.success("追加しました");
        } else {
          await onRename({ id: dialogState.id, name: trimmed });
          toast.success("名称を変更しました");
        }
        setDialogState(null);
        router.refresh();
      } catch {
        toast.error("入力内容をご確認ください(同じ名称が既にある場合など)。");
      }
    });
  }

  function handleToggleActive(item: MasterListItem) {
    startTransition(async () => {
      try {
        await onSetActive({ id: item.id, active: !item.active });
        toast.success(item.active ? "非表示にしました" : "表示に戻しました");
        router.refresh();
      } catch {
        toast.error("更新できませんでした。もう一度お試しください。");
      }
    });
  }

  function handleMove(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= items.length) return;
    const reordered = [...items];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    startTransition(async () => {
      try {
        await onReorder(reordered.map((i) => i.id));
        toast.success("並び順を変更しました");
        router.refresh();
      } catch {
        toast.error("並び替えできませんでした。もう一度お試しください。");
      }
    });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <Button size="sm" variant="outline" onClick={openCreateDialog}>
          <PlusIcon data-icon="inline-start" />
          追加
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState title="項目がありません" description="「追加」から登録してください。" />
      ) : (
        <div className="flex flex-col gap-1.5">
          {items.map((item, index) => (
            <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={item.active ? "text-sm text-foreground" : "text-sm text-muted-foreground line-through"}>{item.name}</span>
                {!item.active && <Badge variant="outline">非表示</Badge>}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="上に移動"
                  disabled={index === 0 || isPending}
                  onClick={() => handleMove(index, -1)}
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="下に移動"
                  disabled={index === items.length - 1 || isPending}
                  onClick={() => handleMove(index, 1)}
                >
                  <ArrowDownIcon />
                </Button>
                <Button size="icon-xs" variant="ghost" aria-label="名称を変更" onClick={() => openRenameDialog(item)}>
                  <PencilIcon />
                </Button>
                <Button size="xs" variant="outline" disabled={isPending} onClick={() => handleToggleActive(item)}>
                  {item.active ? "非表示にする" : "表示に戻す"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ResponsiveDialogOrSheet
        open={dialogState !== null}
        onOpenChange={(open) => !open && setDialogState(null)}
        title={dialogState?.mode === "create" ? `${title}を追加` : "名称を変更"}
        footer={
          <Button size="touch" disabled={!name.trim() || isPending} onClick={handleSaveName}>
            {isPending ? "保存中..." : "保存する"}
          </Button>
        }
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="masterName">名称</Label>
          <Input id="masterName" value={name} maxLength={nameMaxLength} onChange={(e) => setName(e.target.value)} className="h-11 text-base" />
        </div>
      </ResponsiveDialogOrSheet>
    </div>
  );
}
