// components/CreateFolderDialog.tsx
"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { FolderPlus, X } from "@phosphor-icons/react";
import { createFolder } from "@/actions/folders";
import { cn } from "@/lib/utils";

interface Props {
  parentFolderId: string | null;
  onSuccess:      () => void;
  onClose:        () => void;
}

export function CreateFolderDialog({ parentFolderId, onSuccess, onClose }: Props) {
  const [name, setName]           = useState("Untitled folder");
  const [error, setError]         = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // Select text on open
  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Folder name cannot be empty");
      return;
    }

    startTransition(async () => {
      try {
        await createFolder(trimmed, parentFolderId);
        onSuccess();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create folder");
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter")  handleSubmit();
    if (e.key === "Escape") onClose();
  };

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-xl p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <FolderPlus size={18} weight="duotone" style={{ color: "#2da07a" }} />
            <h2 className="text-sm font-semibold text-foreground">New folder</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          className={cn(
            "w-full px-3 py-2 rounded-xl text-sm bg-secondary border text-foreground",
            "focus:outline-none focus:ring-1 transition-all",
            error
              ? "border-red-500/50 focus:ring-red-500/30"
              : "border-border focus:ring-[#2da07a]/30 focus:border-[#2da07a]/50"
          )}
          placeholder="Folder name"
          disabled={isPending}
        />

        {error && (
          <p className="mt-1.5 text-xs text-red-400">{error}</p>
        )}

        {/* Buttons */}
        <div className="flex items-center justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending || !name.trim()}
            className={cn(
              "px-4 py-1.5 rounded-xl text-sm font-medium text-white transition-all",
              isPending || !name.trim()
                ? "opacity-50 cursor-not-allowed"
                : "hover:opacity-90"
            )}
            style={{ backgroundColor: "#2da07a" }}
          >
            {isPending ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}