// components/DuplicateUploadDialog.tsx
"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Warning, File as FileIcon, X, Check, SkipForward } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

interface DuplicateUploadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  duplicates: { name: string }[];
  onUpload: () => void;
  onSkip: () => void;
}

export function DuplicateUploadDialog({
  isOpen,
  onClose,
  duplicates,
  onUpload,
  onSkip,
}: DuplicateUploadDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[440px] p-0 gap-0 overflow-hidden bg-background/95 backdrop-blur-xl border-border/50 shadow-2xl">
        <DialogHeader className="p-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-500 ring-1 ring-amber-500/20">
              <Warning size={28} weight="duotone" />
            </div>
            <div className="flex-1 min-w-0 text-left">
              <DialogTitle className="text-xl font-bold tracking-tight">Duplicate Files</DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground mt-0.5">
                Some files already exist in this folder.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-2">
          <div className="max-h-[200px] overflow-y-auto rounded-xl border border-border/50 bg-muted/30 scrollbar-hide">
            <div className="p-2 space-y-1">
              {duplicates.map((file, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-2 rounded-lg bg-background/50 border border-border/30"
                >
                  <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground">
                    <FileIcon size={16} weight="duotone" />
                  </div>
                  <span className="text-sm font-medium truncate flex-1">
                    {file.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed px-1">
            "Upload" will save these as new versions of existing files. "Skip" will only upload files that don't already exist.
          </p>
        </div>

        <DialogFooter className="p-6 pt-4 flex flex-col sm:flex-row gap-2">
          <Button
            variant="ghost"
            onClick={onClose}
            className="flex-1 rounded-xl h-11 text-muted-foreground hover:text-foreground hover:bg-muted font-semibold transition-all gap-2"
          >
            <X size={18} />
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={onSkip}
            className="flex-1 rounded-xl h-11 border-border/50 hover:bg-secondary hover:text-foreground font-semibold transition-all gap-2"
          >
            <SkipForward size={18} weight="bold" />
            Skip
          </Button>
          <Button
            onClick={onUpload}
            className="flex-[1.5] rounded-xl h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-bold transition-all shadow-lg shadow-primary/20 gap-2"
          >
            <Check size={18} weight="bold" />
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
