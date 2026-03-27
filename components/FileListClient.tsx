// components/FileListClient.tsx
"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus, CloudArrowUp } from "@phosphor-icons/react";
import { FileGrid } from "@/components/FileGrid";
import { getFiles } from "@/actions/files";
import { useUpload } from "@/hooks/useUpload";
import { cn } from "@/lib/utils";
import { CreateFolderDialog } from "./CreateFolderDialog";
import { ActionsDropdown } from "./UploadDropdown";

interface Props {
  initialFiles: any[];
  initialFolders: any[];
  user: {
    id: string;
    storage_used: number;
    storage_limit: number;
  };
}

const TEAL = "#2da07a";

export function FileListClient({ initialFiles, initialFolders, user }: Props) {
  const router = useRouter();
  const [files, setFiles] = useState(initialFiles);
  const [folders, setFolders] = useState(initialFolders);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string; name: string }[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showCreateFolder, setShowCreateFolder] = useState(false);

  const refresh = useCallback(async () => {
    const data = await getFiles(currentFolder);
    setFiles(data.files);
    setFolders(data.folders);
  }, [currentFolder]);

  const { uploadMany } = useUpload({
    parentFolderId: currentFolder ?? undefined,
    onSuccess: () => refresh(),
  });

  // ── Drag and drop ─────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      uploadMany(e.dataTransfer.files);
    }
  };

  // ── Folder navigation ─────────────────────────────────────
  const openFolder = async (id: string, name: string) => {
    setBreadcrumbs((prev) => {
      // ❌ prevent duplicate if already last
      if (prev[prev.length - 1]?.id === id) return prev;
  
      return [...prev, { id, name }];
    });
  
    setCurrentFolder(id);
  
    const data = await getFiles(id);
    setFiles(data.files);
    setFolders(data.folders);
  };

  const navigateToBreadcrumb = async (index: number) => {
    const crumb = breadcrumbs[index];
    const newCrumbs = breadcrumbs.slice(0, index + 1);
    setBreadcrumbs(newCrumbs);
    setCurrentFolder(crumb.id);
    const data = await getFiles(crumb.id);
    setFiles(data.files);
    setFolders(data.folders);
  };

  const navigateToRoot = async () => {
    setBreadcrumbs([]);
    setCurrentFolder(null);
    const data = await getFiles(null);
    setFiles(data.files);
    setFolders(data.folders);
  };

  return (
    <div
      className={cn(
        "flex flex-col h-full p-6 transition-all duration-150",
        isDragging && "bg-[#2da07a]/5 ring-2 ring-inset ring-[#2da07a]/30 rounded-xl"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-6">

        {/* Left: Breadcrumbs */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1 text-sm">
            <button
              onClick={navigateToRoot}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              My Files
            </button>

            {breadcrumbs.map((crumb, i) => (
              <span key={crumb.id} className="flex items-center gap-1">
                <span className="text-muted-foreground">/</span>

                <button
                  onClick={() => navigateToBreadcrumb(i)}
                  className={cn(
                    "transition-colors",
                    i === breadcrumbs.length - 2
                      ? "text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          <ActionsDropdown
            uploadMany={uploadMany}
            setShowCreateFolder={setShowCreateFolder}
            refresh={refresh}
          />
        </div>

        {/* Dialog */}
        {showCreateFolder && (
          <CreateFolderDialog
            parentFolderId={currentFolder}
            onSuccess={refresh}
            onClose={() => setShowCreateFolder(false)}
          />
        )}

      </div>

      {/* ── Drag overlay hint ── */}
      {isDragging && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-2">
            <CloudArrowUp size={40} style={{ color: "#2da07a" }} weight="duotone" />
            <p className="text-sm font-medium" style={{ color: "#2da07a" }}>Drop files to upload</p>
          </div>
        </div>
      )}

      {/* ── File grid ── */}
      <FileGrid
        files={files}
        folders={folders}
        onFolderOpen={openFolder}
        onRefresh={refresh}
      />
    </div>
  );
}