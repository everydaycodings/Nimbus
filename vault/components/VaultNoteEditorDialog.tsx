"use client";

import { useState, useEffect } from "react";
import { X, FloppyDisk, NotePencil, WarningCircle } from "@phosphor-icons/react";
import { useVaultUpload } from "@/vault/hooks/useVaultUpload";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface VaultNoteEditorDialogProps {
  id?: string;
  name?: string;
  initialContent?: string;
  vaultId: string;
  cryptoKey: CryptoKey;
  parentFolderId?: string | null;
  onSuccess: () => void;
  onClose: () => void;
}

const TEAL = "#2da07a";

export function VaultNoteEditorDialog({
  id,
  name: initialName = "",
  initialContent = "",
  vaultId,
  cryptoKey,
  parentFolderId,
  onSuccess,
  onClose,
}: VaultNoteEditorDialogProps) {
  const [content, setContent] = useState(initialContent);
  const [name, setName] = useState(initialName || "Untitled.txt");
  const [isSaving, setIsSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const { uploadFile } = useVaultUpload(vaultId, cryptoKey, {
    parentFolderId: parentFolderId ?? undefined,
    onSuccess: () => {
      setIsSaving(false);
      toast.success(id ? "Note updated successfully" : "Note created successfully");
      onSuccess();
      onClose();
    },
  });

  const handleSave = async (bypassConfirm = false) => {
    if (!name.trim()) {
      toast.error("Please enter a filename");
      return;
    }

    if (id && !bypassConfirm) {
      setShowConfirm(true);
      return;
    }

    let fileName = name;
    if (!fileName.toLowerCase().endsWith(".txt")) {
      fileName += ".txt";
    }

    setIsSaving(true);
    setShowConfirm(false);

    try {
      const blob = new Blob([content], { type: "text/plain" });
      const file = new File([blob], fileName, { type: "text/plain" });
      await uploadFile(file, id); 
    } catch (err) {
      setIsSaving(false);
      console.error(err);
      toast.error("Failed to save note");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 bg-background/80 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-4xl h-full sm:h-[80vh] flex flex-col bg-card border-x-0 sm:border border-border rounded-none sm:rounded-2xl shadow-2xl overflow-hidden glassmorphism">
        
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-border">
          <div className="flex items-center gap-2 sm:gap-3">
            <NotePencil size={20} className="sm:w-6 sm:h-6" weight="duotone" style={{ color: TEAL }} />
            <div className="flex flex-col">
              <input
                value={name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
                placeholder="Filename.txt"
                className="bg-transparent text-base sm:text-lg font-semibold text-foreground focus:outline-none transition-all w-full max-w-[150px] sm:max-w-none truncate"
                disabled={!!id}
              />
              <p className="text-xs text-muted-foreground font-medium">
                <span className="text-[#2da07a]">Encrypted</span> • End-to-end secure
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleSave()}
              disabled={isSaving}
              className={cn(
                "flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-medium transition-all shadow-sm",
                "bg-[#2da07a] text-white hover:bg-[#2da07a]/90 disabled:opacity-50"
              )}
            >
              {isSaving ? (
                <div className="w-3.5 h-3.5 sm:w-4 sm:h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <FloppyDisk size={16} className="sm:w-[18px] sm:h-[18px]" weight="bold" />
              )}
              Save
            </button>
            <button
              onClick={onClose}
              className="p-1.5 sm:p-2 rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <X size={18} className="sm:w-5 sm:h-5" weight="bold" />
            </button>
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 p-0 flex flex-col overflow-hidden">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Start writing securely..."
            className="flex-1 w-full h-full p-4 sm:p-6 bg-transparent text-foreground resize-none focus:outline-none scrollbar-fancy leading-relaxed text-sm sm:text-base placeholder:text-muted-foreground/50"
            autoFocus
          />
        </div>

        {/* Footer info */}
        <div className="px-4 sm:px-6 py-2 border-t border-border bg-muted/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 sm:gap-0">
          <p className="text-[10px] sm:text-xs text-muted-foreground">
            {content.length} characters • {content.split(/\s+/).filter(Boolean).length} words
          </p>
          <div className="flex items-center gap-2 text-[10px] sm:text-xs text-muted-foreground italic">
            <WarningCircle size={12} className="text-amber-500/80 sm:w-3.5 sm:h-3.5" />
            Files are encrypted before even leaving your browser.
          </div>
        </div>

        {/* Overwrite Confirmation Overlay */}
        {showConfirm && (
          <div className="absolute inset-0 bg-background/40 backdrop-blur-md flex items-center justify-center p-4 z-[60] animate-in fade-in zoom-in-95">
            <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl p-6">
              <div className="flex items-center gap-3 mb-4 text-amber-500">
                <WarningCircle size={28} weight="fill" />
                <h3 className="text-lg font-bold text-foreground">Confirm Overwrite</h3>
              </div>
              <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                You are about to overwrite an existing encrypted file. This action cannot be undone. Are you sure?
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="px-4 py-2 rounded-xl text-sm font-medium hover:bg-accent transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleSave(true)}
                  className="px-4 py-2 rounded-xl text-sm font-medium bg-[#2da07a] text-white hover:opacity-90 transition-all"
                >
                  Overwrite
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
