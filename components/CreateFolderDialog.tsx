// components/CreateFolderDialog.tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { FolderPlus, X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useCreateFolderMutation } from "@/hooks/mutations/useFileMutations";

interface Props {
  parentFolderId: string | null;
  onSuccess: () => void;
  onClose: () => void;
}

export function CreateFolderDialog({ parentFolderId, onSuccess, onClose }: Props) {
  const [name, setName] = useState("");
  const createFolderMutation = useCreateFolderMutation();
  const isPending = createFolderMutation.isPending;
  const inputRef = useRef<HTMLInputElement>(null);

  // Select text on open
  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Folder name cannot be empty");
      return;
    }

    createFolderMutation.mutate(
      { name: trimmed, parentFolderId },
      {
        onSuccess: () => {
          toast.success("Folder created!");
          onSuccess();
          onClose();
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : "Failed to create folder");
        },
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit();
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
          }}
          onKeyDown={handleKeyDown}
          className={cn(
            "w-full px-3 py-2 rounded-xl text-sm bg-secondary border text-foreground",
            "focus:outline-none focus:ring-1 transition-all",
            "border-border focus:ring-[#2da07a]/30 focus:border-[#2da07a]/50"
          )}
          placeholder="Folder name"
          disabled={isPending}
        />

        {/* Buttons */}
        <div className="flex items-center justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending || !name.trim()}
            className={cn(
              "px-4 py-1.5 rounded-xl text-sm font-medium text-white cursor-pointer transition-all",
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