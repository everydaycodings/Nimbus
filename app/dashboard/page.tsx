// app/(dashboard)/page.tsx
"use client";

import { useState, useCallback } from "react";
import {
  CloudArrowUp,
  FolderPlus,
  HardDrive,
} from "@phosphor-icons/react";
import { FileGrid } from "@/components/FileGrid";
import { CreateFolderDialog } from "@/components/CreateFolderDialog";
import { useUpload } from "@/hooks/useUpload";
import { cn } from "@/lib/utils";
import { ActionsDropdown } from "@/components/UploadDropdown";
import { NoteEditorDialog } from "@/components/NoteEditorDialog";
import { useRouter, useSearchParams } from "next/navigation";
import { FileFilters } from "@/components/FileFilters";
import { useFilesQuery } from "@/hooks/queries/useFilesQuery";
import { DuplicateUploadDialog } from "@/components/DuplicateUploadDialog";
import { checkFilesExist } from "@/actions/files";

const TEAL = "#2da07a";

export default function HomePage() {
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [noteEditor, setNoteEditor] = useState<{
    open: boolean;
    id?: string;
    name?: string;
    content?: string;
  }>({ open: false });
  const [duplicateCheck, setDuplicateCheck] = useState<{
    open: boolean;
    duplicates: { file: File; existingId: string }[];
    allFiles: File[];
  }>({ open: false, duplicates: [], allFiles: [] });

  const router = useRouter();
  const searchParams = useSearchParams();

  const type = searchParams.get("type");
  const sortBy = searchParams.get("sortBy");
  const sortOrder = searchParams.get("sortOrder");
  const minSize = searchParams.get("minSize") ? Number(searchParams.get("minSize")) : undefined;
  const maxSize = searchParams.get("maxSize") ? Number(searchParams.get("maxSize")) : undefined;
  const tagId = searchParams.get("tagId") || undefined;

  const queryOptions = {
    type: type || undefined,
    sortBy: sortBy || undefined,
    sortOrder: sortOrder || undefined,
    minSize,
    maxSize,
    tagId,
  };

  const { data, isLoading: loading, refetch: refresh } = useFilesQuery(null, queryOptions);

  const files = (data?.files ?? []) as any[];
  const folders = (data?.folders ?? []) as any[];

  const { upload, uploadMany, cancelUpload } = useUpload({
    parentFolderId: undefined,
    onSuccess: () => refresh(),
  });

  const handleUploadFiles = useCallback(async (incomingFiles: FileList | File[]) => {
    const fileList = Array.from(incomingFiles);
    const names = fileList.map(f => f.name);

    try {
      // Home page is root folder, so parentFolderId is null
      const existingFiles = await checkFilesExist(null, names);
      const duplicates: { file: File; existingId: string }[] = [];

      existingFiles.forEach(existing => {
        const file = fileList.find(f => f.name === existing.name);
        if (file) {
          duplicates.push({ file, existingId: existing.id });
        }
      });

      if (duplicates.length > 0) {
        setDuplicateCheck({ open: true, duplicates, allFiles: fileList });
      } else {
        uploadMany(fileList);
      }
    } catch (err) {
      console.error("Duplicate check failed", err);
      uploadMany(fileList);
    }
  }, [uploadMany]);

  const handleProcessDuplicates = (action: "upload" | "skip") => {
    if (action === "upload") {
      duplicateCheck.allFiles.forEach(file => {
        const dup = duplicateCheck.duplicates.find(d => d.file.name === file.name);
        upload(file, dup?.existingId);
      });
    } else if (action === "skip") {
      const nonDuplicates = duplicateCheck.allFiles.filter(
        f => !duplicateCheck.duplicates.some(d => d.file.name === f.name)
      );
      if (nonDuplicates.length > 0) uploadMany(nonDuplicates);
    }
    setDuplicateCheck({ open: false, duplicates: [], allFiles: [] });
  };
  
  // ── Note Editing ──────────────────────────────────────────
  const handleEditNote = async (file: any) => {
    try {
      let content = "";
      if (file.signed_url || file.download_url) {
        const res = await fetch(file.signed_url || file.download_url);
        if (res.ok) content = await res.text();
      }
      setNoteEditor({
        open: true,
        id: file.id,
        name: file.name,
        content: content,
      });
    } catch (err) {
      console.error("Failed to fetch note content", err);
    }
  };

  const enhancedFiles = files.map((f) => ({
    ...f,
    onEdit: () => handleEditNote(f),
  }));

  // ── Drag and drop ─────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) handleUploadFiles(e.dataTransfer.files);
  };

  const totalItems = files.length + folders.length;

  return (
    <div
      className={cn(
        "flex flex-col h-full p-4 md:p-6 transition-all duration-150 relative",
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
          <ActionsDropdown
            onUpload={handleUploadFiles}
            setShowCreateFolder={setShowCreateFolder}
            refresh={refresh}
            onNewNote={() => setNoteEditor({ open: true })}
          />
        </div>
      </div>

      {/* ── Filters ── */}
      <FileFilters />


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
          <div className="flex flex-col sm:flex-row items-center gap-3">
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
                onChange={(e) => e.target.files && handleUploadFiles(e.target.files)}
              />
            </label>
          </div>
        </div>
      ) : (
        <FileGrid
          files={enhancedFiles}
          folders={folders}
          onFolderOpen={(id) => {
            router.push(`/dashboard/files?folder=${id}`);
          }}
          onRefresh={refresh}
        />
      )}

      {/* ── Dialogs ── */}
      {duplicateCheck.open && (
        <DuplicateUploadDialog
          isOpen={duplicateCheck.open}
          duplicates={duplicateCheck.duplicates.map(d => ({ name: d.file.name }))}
          onClose={() => setDuplicateCheck({ open: false, duplicates: [], allFiles: [] })}
          onUpload={() => handleProcessDuplicates("upload")}
          onSkip={() => handleProcessDuplicates("skip")}
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

      {noteEditor.open && (
        <NoteEditorDialog
          id={noteEditor.id}
          name={noteEditor.name}
          initialContent={noteEditor.content}
          parentFolderId={null}
          onSuccess={refresh}
          onClose={() => setNoteEditor({ open: false })}
        />
      )}
    </div>
  );
}