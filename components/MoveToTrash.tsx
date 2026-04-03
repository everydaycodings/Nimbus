// components/MoveToTrash.tsx
"use client";

import { useTransition } from "react";
import { Trash, X, Warning } from "@phosphor-icons/react";
import { trashItem } from "@/actions/files";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getQueryClient } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";

interface Props {
  id: string;
  name: string;
  type: "file" | "folder" | "version";
  onSuccess: () => void;
  onClose: () => void;
}

export function MoveToTrash({ id, name, type, onSuccess, onClose }: Props) {
  const [isPending, startTransition] = useTransition();

  const handleConfirm = () => {
    startTransition(async () => {
      try {
        await trashItem(id, type);
        toast.success(`"${name}" moved to trash`);
        getQueryClient().invalidateQueries({ queryKey: queryKeys.all });
        onSuccess();
        onClose();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to move item to trash");
      }
    });
  };

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-xl p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-red-500/10">
              <Trash size={20} weight="fill" className="text-red-500" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">Move to Trash</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-3 mb-6">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Are you sure you want to move <span className="text-foreground font-medium">"{name}"</span> to the trash?
          </p>
          <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/5 border border-amber-500/10">
            <Warning size={16} className="text-amber-500 flex-shrink-0 mt-0.5" weight="fill" />
            <p className="text-[11px] text-amber-500/80">
              You can restore items from the trash later if needed.
            </p>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isPending}
            className={cn(
              "px-5 py-2 rounded-xl text-sm font-medium text-white cursor-pointer transition-all bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/20",
              isPending && "opacity-50 cursor-not-allowed"
            )}
          >
            {isPending ? "Moving..." : "Move to Trash"}
          </button>
        </div>
      </div>
    </div>
  );
}
