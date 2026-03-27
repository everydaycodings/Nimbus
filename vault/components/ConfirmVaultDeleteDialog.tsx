"use client";

import { Trash, X } from "@phosphor-icons/react";

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  description?: string;
};

export function ConfirmVaultDeleteDialog({
  open,
  onClose,
  onConfirm,
  title = "Delete item?",
  description = "This action cannot be undone.",
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative z-10 w-[360px] rounded-2xl border border-border bg-background shadow-2xl p-5 animate-in fade-in zoom-in-95">
        
        {/* Header */}
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
            <Trash size={16} className="text-red-500" />
          </div>
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>

        {/* Description */}
        <p className="text-xs text-muted-foreground mb-5">
          {description}
        </p>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition"
          >
            Cancel
          </button>

          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className="px-3 py-1.5 text-xs rounded-lg bg-red-500 text-white hover:bg-red-600 transition flex items-center gap-1"
          >
            <Trash size={12} />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}