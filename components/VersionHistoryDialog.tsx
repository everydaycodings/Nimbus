// components/VersionHistoryDialog.tsx
"use client";

import { useFileVersions } from "@/hooks/queries/useFileVersions";
import { useUpload } from "@/hooks/useUpload";
import { useDownload } from "@/hooks/useDownload";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBytes, formatDate } from "@/lib/format";
import {
  DownloadSimple,
  ArrowCounterClockwise,
  Trash,
  ClockCounterClockwise,
  CloudArrowUp,
  File as FileIcon,
  Spinner,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRef } from "react";

interface VersionHistoryDialogProps {
  fileId: string;
  fileName: string;
  onClose: () => void;
}

export function VersionHistoryDialog({
  fileId,
  fileName,
  onClose,
}: VersionHistoryDialogProps) {
  const {
    versions,
    isLoading,
    restoreVersion,
    isRestoring,
    deleteVersion,
    isDeleting,
  } = useFileVersions(fileId);

  const { upload } = useUpload();
  const { download, downloading } = useDownload();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    upload(file, fileId);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md md:max-w-lg p-0 gap-0 overflow-hidden bg-background/95 backdrop-blur-xl border-border/50 shadow-2xl">
        <DialogHeader className="p-6 border-b border-border/50 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              <ClockCounterClockwise size={24} weight="duotone" />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold tracking-tight">Version History</DialogTitle>
              <p className="text-sm text-muted-foreground truncate max-w-[280px]">
                {fileName}
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="p-4 bg-muted/30 border-b border-border/50">
          <input
            type="file"
            className="hidden"
            ref={fileInputRef}
            onChange={handleUpload}
          />
          <Button
            variant="outline"
            className="w-full h-12 dashed border-dashed border-2 hover:bg-primary/5 hover:border-primary/50 transition-all gap-2"
            onClick={() => fileInputRef.current?.click()}
          >
            <CloudArrowUp size={20} weight="duotone" />
            Upload new version
          </Button>
        </div>

        <div className="max-h-[400px] overflow-y-auto">
          <div className="p-4 space-y-3">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
                <Spinner size={32} className="animate-spin text-primary" />
                <p className="text-sm">Loading versions...</p>
              </div>
            ) : versions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground/60">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                  <FileIcon size={32} weight="duotone" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-foreground">No previous versions</p>
                  <p className="text-xs">Earlier versions of this file will appear here.</p>
                </div>
              </div>
            ) : (
              versions.map((version: any, idx: number) => (
                <div
                  key={version.id}
                  className="group relative flex items-center gap-4 p-3 rounded-xl border border-transparent hover:border-border hover:bg-muted/50 transition-all"
                >
                  <div className="w-10 h-10 rounded-lg bg-secondary flex flex-col items-center justify-center text-[10px] font-bold text-muted-foreground ring-1 ring-border/50">
                    <span className="text-xs uppercase opacity-60">V</span>
                    {version.version_number}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-semibold truncate leading-none">
                        {version.name}
                      </p>
                    </div>
                    <p className="text-[10px] text-muted-foreground font-medium">
                      {formatDate(version.created_at)} • {formatBytes(version.size)}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 rounded-lg hover:bg-primary/10 hover:text-primary transition-colors"
                      onClick={() =>
                        download(version.id, version.name, "file", version.download_url)
                      }
                      disabled={downloading.has(version.id)}
                      title="Download"
                    >
                      {downloading.has(version.id) ? (
                        <Spinner size={16} className="animate-spin" />
                      ) : (
                        <DownloadSimple size={16} weight="bold" />
                      )}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 rounded-lg hover:bg-blue-500/10 hover:text-blue-500 transition-colors"
                      onClick={() => restoreVersion(version.id)}
                      disabled={isRestoring}
                      title="Restore"
                    >
                      {isRestoring ? (
                        <Spinner size={16} className="animate-spin" />
                      ) : (
                        <ArrowCounterClockwise size={16} weight="bold" />
                      )}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 rounded-lg hover:bg-red-500/10 hover:text-red-500 transition-colors"
                      onClick={() => deleteVersion(version.id)}
                      disabled={isDeleting}
                      title="Move to trash"
                    >
                      {isDeleting ? (
                        <Spinner size={16} className="animate-spin" />
                      ) : (
                        <Trash size={16} weight="bold" />
                      )}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="p-4 border-t border-border/50 bg-muted/20">
          <p className="text-[10px] text-center text-muted-foreground leading-relaxed">
            Restoring a version will move the current version to history.<br />
            Trashed versions can be recovered from the Trash.<br />
            Storage is consumed for each saved version.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
