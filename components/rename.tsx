// components/rename.tsx
"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { PencilSimple, X } from "@phosphor-icons/react";
import { renameItem } from "@/actions/files";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Props {
  id: string;
  name: string;
  type: "file" | "folder";
  onSuccess: () => void;
  onClose: () => void;
}

export function RenameDialog({ id, name, type, onSuccess, onClose }: Props) {
  const [newName, setNewName] = useState(name);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // Select text on open (excluding extension if it's a file)
  useEffect(() => {
    if (inputRef.current) {
      const dotIndex = name.lastIndexOf(".");
      if (type === "file" && dotIndex > 0) {
        inputRef.current.setSelectionRange(0, dotIndex);
      } else {
        inputRef.current.select();
      }
      inputRef.current.focus();
    }
  }, [name, type]);

  const handleSubmit = () => {
    const trimmed = newName.trim();
    if (!trimmed) {
      toast.error("Name cannot be empty");
      return;
    }

    if (trimmed === name) {
      onClose();
      return;
    }

    startTransition(async () => {
      try {
        await renameItem(id, type, trimmed);
        toast.success("Renamed successfully!");
        onSuccess();
        onClose();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to rename item");
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit();
    if (e.key === "Escape") onClose();
  };

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-xl p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <PencilSimple size={18} weight="duotone" style={{ color: "#2da07a" }} />
            <h2 className="text-sm font-semibold text-foreground">Rename</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Label and Info */}
        <p className="text-xs text-muted-foreground mb-4">
          Enter a new name for <span className="text-foreground font-medium">"{name}"</span>
        </p>

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={newName}
          onChange={(e) => {
            setNewName(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          className={cn(
            "w-full px-3 py-2 rounded-xl text-sm bg-secondary border text-foreground",
            "focus:outline-none focus:ring-1 transition-all",
            "border-border focus:ring-[#2da07a]/30 focus:border-[#2da07a]/50"
          )}
          placeholder="New name"
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
            disabled={isPending || !newName.trim()}
            className={cn(
              "px-4 py-1.5 rounded-xl text-sm font-medium text-white cursor-pointer transition-all",
              isPending || !newName.trim()
                ? "opacity-50 cursor-not-allowed"
                : "hover:opacity-90"
            )}
            style={{ backgroundColor: "#2da07a" }}
          >
            {isPending ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
