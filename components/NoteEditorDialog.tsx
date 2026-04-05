"use client";

import { useState, useEffect } from "react";
import { X, FloppyDisk, NotePencil } from "@phosphor-icons/react";
import { useUpload } from "@/hooks/useUpload";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface NoteEditorDialogProps {
  id?: string;
  name?: string;
  initialContent?: string;
  parentFolderId?: string | null;
  onSuccess: () => void;
  onClose: () => void;
}

const TEAL = "#2da07a";

export function NoteEditorDialog({
  id,
  name: initialName = "",
  initialContent = "",
  parentFolderId,
  onSuccess,
  onClose,
}: NoteEditorDialogProps) {
  const [content, setContent] = useState(initialContent);
  const [name, setName] = useState(initialName || "Untitled.txt");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(!!id && !initialContent);

  const { upload } = useUpload({
    parentFolderId: parentFolderId ?? undefined,
    onSuccess: () => {
      setIsSaving(false);
      toast.success(id ? "Note updated successfully" : "Note created successfully");
      onSuccess();
      onClose();
    },
    onError: (err) => {
      setIsSaving(false);
      toast.error(err);
    },
  });

  // Fetch content if editing and not provided
  useEffect(() => {
    if (id && !initialContent) {
      // We assume the signedUrl is fetched from the list and passed down
      // But if not, we can't easily fetch it here without an API call.
      // For now, let's assume it's passed or we'll add content fetching in the parent.
    }
  }, [id, initialContent]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Please enter a filename");
      return;
    }

    let fileName = name;
    if (!fileName.toLowerCase().endsWith(".txt")) {
      fileName += ".txt";
    }

    setIsSaving(true);
    try {
      const blob = new Blob([content], { type: "text/plain" });
      const file = new File([blob], fileName, { type: "text/plain" });
      await upload(file, id); // originalFileId (id) will trigger versioning if present
    } catch (err) {
      setIsSaving(false);
      console.error(err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-4xl h-[80vh] flex flex-col bg-card border border-border rounded-2xl shadow-2xl overflow-hidden glassmorphism">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <NotePencil size={24} weight="duotone" style={{ color: TEAL }} />
            <div className="flex flex-col">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Filename.txt"
                className="bg-transparent text-lg font-semibold text-foreground focus:outline-none transition-all"
                disabled={!!id} // Renaming is handled by a different dialog usually
              />
              <p className="text-xs text-muted-foreground">Markdown supported (plain text)</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all shadow-sm",
                "bg-[#2da07a] text-white hover:bg-[#2da07a]/90 disabled:opacity-50"
              )}
            >
              {isSaving ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <FloppyDisk size={18} weight="bold" />
              )}
              Save
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <X size={20} weight="bold" />
            </button>
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 p-0 flex flex-col overflow-hidden">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Start writing your thoughts..."
            className="flex-1 w-full h-full p-6 bg-transparent text-foreground resize-none focus:outline-none scrollbar-fancy leading-relaxed text-base"
            autoFocus
          />
        </div>

        {/* Footer info */}
        <div className="px-6 py-2 border-t border-border bg-muted/30 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {content.length} characters • {content.split(/\s+/).filter(Boolean).length} words
          </p>
          <p className="text-xs text-muted-foreground italic">
            Changes are saved as new versions automatically.
          </p>
        </div>
      </div>
    </div>
  );
}
