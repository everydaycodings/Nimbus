// components/DeletePermanently.tsx
"use client";

import { useTransition } from "react";
import { Trash, X, Warning } from "@phosphor-icons/react";
import { deleteItemPermanently } from "@/actions/trash";
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

export function DeletePermanently({ id, name, type, onSuccess, onClose }: Props) {
  const [isPending, startTransition] = useTransition();

  const handleConfirm = () => {
    startTransition(async () => {
      try {
        await deleteItemPermanently(id, type);
        toast.success(`"${name}" deleted permanently`);
        getQueryClient().invalidateQueries({ queryKey: queryKeys.all });
        onSuccess();
        onClose();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to delete item");
      }
    });
  };

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-xl p-6 animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-red-500/10">
              <Trash size={20} weight="fill" className="text-red-500" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">Delete Permanently</h2>
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
            Are you sure you want to permanently delete <span className="text-foreground font-medium">"{name}"</span>?
          </p>
          <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/5 border border-red-500/10">
            <Warning size={16} className="text-red-500 flex-shrink-0 mt-0.5" weight="fill" />
            <p className="text-[11px] text-red-500/80">
              This action is irreversible. All associated data and sub-items will be lost.
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
            {isPending ? "Deleting..." : "Delete Permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}
