// app/(dashboard)/page.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import {
  CloudArrowUp,
  FolderPlus,
  HardDrive,
  File,
  X,
} from "@phosphor-icons/react";
import { FileGrid } from "@/components/FileGrid";
import { CreateFolderDialog } from "@/components/CreateFolderDialog";
import { getFiles } from "@/actions/files";
import { useUpload } from "@/hooks/useUpload";
import { useUploadStore } from "@/store/uploadStore";
import { cn } from "@/lib/utils";
import { UploadFolderButton } from "@/components/UploadFolderButton";

const TEAL = "#2da07a";

export default function HomePage() {
  const [files,            setFiles]            = useState<any[]>([]);
  const [folders,          setFolders]          = useState<any[]>([]);
  const [loading,          setLoading]          = useState(true);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [isDragging,       setIsDragging]       = useState(false);

  // Read uploads from global store
  const uploads = useUploadStore((s) => s.uploads);

  const refresh = useCallback(async () => {
    const data = await getFiles(null);
    setFiles(data.files);
    setFolders(data.folders);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const { uploadMany, cancelUpload } = useUpload({
    parentFolderId: undefined,
    onSuccess: () => refresh(),
  });

  // ── Drag and drop ─────────────────────────────────────────
  const handleDragOver  = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => {
    // Only hide overlay when leaving the container entirely
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) uploadMany(e.dataTransfer.files);
  };

  const totalItems = files.length + folders.length;

  return (
    <div
      className={cn(
        "flex flex-col h-full p-6 transition-all duration-150 relative",
        isDragging && "bg-[#2da07a]/5 ring-2 ring-inset ring-[#2da07a]/30 rounded-xl"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">Home</h1>
          {!loading && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {totalItems === 0
                ? "No files yet"
                : `${folders.length} folder${folders.length !== 1 ? "s" : ""}, ${files.length} file${files.length !== 1 ? "s" : ""}`
              }
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-secondary border border-border text-secondary-foreground hover:bg-accent hover:text-accent-foreground transition-all cursor-pointer">
            <CloudArrowUp size={16} weight="duotone" style={{ color: TEAL }} />
            Upload
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && uploadMany(e.target.files)}
            />
          </label>
          <button
            onClick={() => setShowCreateFolder(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-secondary border border-border text-secondary-foreground hover:bg-accent hover:text-accent-foreground transition-all"
          >
            <FolderPlus size={16} weight="duotone" style={{ color: TEAL }} />
            New folder
          </button>
          <UploadFolderButton
  parentFolderId={null}
  onSuccess={() => refresh()}
/>
        </div>
      </div>


      {/* ── Drag overlay ── */}
      {isDragging && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="flex flex-col items-center gap-2">
            <CloudArrowUp size={48} weight="duotone" style={{ color: TEAL }} />
            <p className="text-sm font-medium" style={{ color: TEAL }}>
              Drop files to upload
            </p>
          </div>
        </div>
      )}

      {/* ── Content ── */}
      {loading ? (
        <div className="flex flex-col gap-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-10 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : totalItems === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-center">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ backgroundColor: `${TEAL}18` }}
          >
            <HardDrive size={32} weight="duotone" style={{ color: TEAL }} />
          </div>
          <h2 className="text-base font-semibold text-foreground mb-1">
            Your drive is empty
          </h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-xs">
            Upload files or create a folder to get started. You can also drag and drop files anywhere on this page.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowCreateFolder(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-secondary border border-border text-secondary-foreground hover:bg-accent transition-all"
            >
              <FolderPlus size={16} weight="duotone" style={{ color: TEAL }} />
              New folder
            </button>
            <label
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white cursor-pointer hover:opacity-90 transition-all"
              style={{ backgroundColor: TEAL }}
            >
              <CloudArrowUp size={16} weight="bold" />
              Upload files
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && uploadMany(e.target.files)}
              />
            </label>
          </div>
        </div>
      ) : (
        <FileGrid
          files={files}
          folders={folders}
          onFolderOpen={(id) => {
            window.location.href = `/files?folder=${id}`;
          }}
          onRefresh={refresh}
        />
      )}

      {/* ── Create folder dialog ── */}
      {showCreateFolder && (
        <CreateFolderDialog
          parentFolderId={null}
          onSuccess={refresh}
          onClose={() => setShowCreateFolder(false)}
        />
      )}
    </div>
  );
}