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
import { Warning, File as FileIcon, Check, SkipForward } from "@phosphor-icons/react";
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
        <DialogHeader className="p-5 sm:p-6 pb-2 sm:pb-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-3">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-500 ring-1 ring-amber-500/20 shrink-0">
              <Warning size={24} className="sm:hidden" weight="duotone" />
              <Warning size={28} className="hidden sm:block" weight="duotone" />
            </div>
            <div className="flex-1 min-w-0 text-left">
              <DialogTitle className="text-lg sm:text-xl font-bold tracking-tight leading-tight">Duplicate Files Found</DialogTitle>
              <DialogDescription className="text-xs sm:text-sm text-muted-foreground mt-1">
                The following files already exist in this directory. How would you like to proceed?
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-5 sm:px-6 py-2">
          <div className="max-h-[160px] sm:max-h-[200px] overflow-y-auto rounded-xl border border-border/50 bg-muted/30 scrollbar-hide">
            <div className="p-2 space-y-1">
              {duplicates.map((file, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-2 rounded-lg bg-background/50 border border-border/30"
                >
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground">
                    <FileIcon size={16} weight="duotone" />
                  </div>
                  <span className="text-xs sm:text-sm font-medium truncate flex-1">
                    {file.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-[10px] sm:text-[11px] text-muted-foreground mt-3 leading-relaxed px-1">
            <span className="font-semibold text-foreground/80">Upload:</span> Saves as new versions. <span className="font-semibold text-foreground/80">Skip:</span> Only uploads new files.
          </p>
        </div>

        <DialogFooter className="p-5 sm:p-6 pt-4 sm:pt-4 flex flex-col sm:flex-row gap-2 sm:gap-3 m-0 border-t bg-muted/20">
          <Button
            variant="outline"
            onClick={onSkip}
            className="w-full sm:flex-1 rounded-xl h-10 sm:h-11 border-border/50 hover:bg-secondary hover:text-foreground font-semibold transition-all gap-2 order-2 sm:order-1"
          >
            <SkipForward size={18} weight="bold" />
            Skip
          </Button>
          <Button
            onClick={onUpload}
            className="w-full sm:flex-[1.5] rounded-xl h-10 sm:h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-bold transition-all shadow-lg shadow-primary/20 gap-2 order-1 sm:order-2"
          >
            <Check size={18} weight="bold" />
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
