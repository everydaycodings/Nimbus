// app/(dashboard)/trash/page.tsx
"use client";

import { useState, useEffect, useCallback, useTransition } from "react";
import { Trash, ArrowCounterClockwise, Warning } from "@phosphor-icons/react";
import { FileGrid } from "@/components/FileGrid";
import { getTrashedItems } from "@/actions/files";
import { emptyTrash } from "@/actions/trash";
import { cn } from "@/lib/utils";

export default function TrashPage() {
  const [files,          setFiles]          = useState<any[]>([]);
  const [folders,        setFolders]        = useState<any[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [showConfirm,    setShowConfirm]    = useState(false);
  const [isPending,      startTransition]   = useTransition();

  const refresh = useCallback(async () => {
    const data = await getTrashedItems();
    setFiles(data.files);
    setFolders(data.folders);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const handleEmptyTrash = () => {
    startTransition(async () => {
      await emptyTrash();
      setShowConfirm(false);
      await refresh();
    });
  };

  const isEmpty = !loading && files.length === 0 && folders.length === 0;

  return (
    <div className="flex flex-col h-full p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Trash size={20} weight="duotone" className="text-muted-foreground" />
          <h1 className="text-lg font-semibold text-foreground">Trash</h1>
        </div>

        {!isEmpty && (
          <button
            onClick={() => setShowConfirm(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium text-red-400 border border-red-400/20 hover:bg-red-400/10 transition-all"
          >
            <Trash size={14} />
            Empty trash
          </button>
        )}
      </div>

      {/* Info banner */}
      {!isEmpty && (
        <div className="flex items-center gap-2 px-3 py-2 mb-4 rounded-xl bg-muted border border-border text-xs text-muted-foreground">
          <Warning size={14} className="flex-shrink-0" />
          Items in trash are automatically deleted after 30 days.
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-10 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <Trash size={48} weight="duotone" className="text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">Trash is empty</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Deleted files will appear here
          </p>
        </div>
      ) : (
        <FileGrid
          files={files}
          folders={folders}
          showRestore={true}
          onRefresh={refresh}
        />
      )}

      {/* Empty trash confirm dialog */}
      {showConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={(e) => e.target === e.currentTarget && setShowConfirm(false)}
        >
          <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <Warning size={18} className="text-red-400 flex-shrink-0" />
              <h2 className="text-sm font-semibold text-foreground">Empty trash?</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              All {files.length + folders.length} items will be permanently deleted. This cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-3 py-1.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleEmptyTrash}
                disabled={isPending}
                className={cn(
                  "px-4 py-1.5 rounded-xl text-sm font-medium text-white bg-red-500 transition-all",
                  isPending ? "opacity-50 cursor-not-allowed" : "hover:bg-red-600"
                )}
              >
                {isPending ? "Deleting..." : "Empty trash"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}