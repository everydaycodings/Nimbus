// offline-vault/components/LocalFileExplorer.tsx
"use client";

import { useState, useRef, useMemo, useEffect } from "react";
import {
  FileArrowDown,
  Trash,
  FileText,
  LockSimple,
  LockKeyOpen,
  FolderSimple,
  Folder,
  X,
  Funnel,
  FolderPlus,
  Eye,
  CaretRight,
} from "@phosphor-icons/react";
import { useOfflineVault } from "../hooks/useOfflineVault";
import Breadcrumbs from "./Breadcrumbs";
import { ShieldCheck as ShieldCheckIcon } from "@phosphor-icons/react";
import { useSearchParams } from "next/navigation";
import { FileFilters } from "@/components/FileFilters";
import VaultUploadDropdown from "@/vault/components/VaultUploadDropdown";
import { cn } from "@/lib/utils";
import { formatBytes, formatDate } from "@/lib/format";
import { FileType, SortBy, SortOrder } from "@/types/filters";
import { LayoutToggle } from "@/components/ui/LayoutToggle";
import { useLayout } from "@/hooks/useLayout";
import VaultItemMenu from "@/vault/components/VaultItemMenu";
import { FileIcon } from "@/components/ui/FileIcon";

const TEAL = "#2da07a";

// ── Create local folder dialog ────────────────────────────────
function CreateLocalFolderDialog({
  onSuccess,
  onClose,
}: {
  onSuccess: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSuccess(trimmed);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <FolderPlus size={16} weight="duotone" style={{ color: TEAL }} />
            <h2 className="text-sm font-semibold text-foreground">New local folder</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <X size={15} />
          </button>
        </div>

        <input
          ref={inputRef}
          type="text"
          placeholder="Folder name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") onClose(); }}
          className="w-full px-3 py-2 rounded-xl text-sm bg-secondary border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-[#2da07a]/30 focus:border-[#2da07a]/50 transition-all"
        />

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim()}
            className="px-4 py-1.5 rounded-xl text-sm font-medium text-white transition-all hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: TEAL }}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LocalFileExplorer() {
  const { 
    files, 
    uploadFile, 
    uploadFolder, 
    createFolder, 
    downloadFile, 
    deleteItem, 
    lockVault, 
    activeVaultName, 
    isLoading 
  } = useOfflineVault();

  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const searchParams = useSearchParams();
  const { layout, handleLayoutChange } = useLayout("nimbus-layout");

  // Filters State
  const type_param = (searchParams.get("type") as FileType) || "all";
  const sortBy = (searchParams.get("sortBy") as SortBy) || "created_at";
  const sortOrder = (searchParams.get("sortOrder") as SortOrder) || "desc";
  const minSize = searchParams.get("minSize") ? Number(searchParams.get("minSize")) : undefined;
  const maxSize = searchParams.get("maxSize") ? Number(searchParams.get("maxSize")) : undefined;

  // Sorting and Filtering Logic (Same as OpenVault)
  const currentFiles = useMemo(() => {
    return files.filter(f => f.parentId === currentFolderId);
  }, [files, currentFolderId]);

  const filteredFiles = useMemo(() => {
    return currentFiles.filter((file) => {
      if (file.type !== "file") return false;
      
      if (type_param !== "all") {
        const mime = file.contentType || "";
        if (type_param === "image" && !mime.startsWith("image/")) return false;
        if (type_param === "video" && !mime.startsWith("video/")) return false;
        if (type_param === "audio" && !mime.startsWith("audio/")) return false;
        if (type_param === "document") {
          const docs = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"];
          if (!docs.includes(mime)) return false;
        }
      }
      if (minSize !== undefined && file.size < minSize) return false;
      if (maxSize !== undefined && file.size > maxSize) return false;
      return true;
    }).sort((a, b) => {
      let comparison = 0;
      if (sortBy === "name") comparison = a.name.localeCompare(b.name);
      else if (sortBy === "size") comparison = a.size - b.size;
      else comparison = b.lastModified - a.lastModified;
      return sortOrder === "asc" ? comparison : -comparison;
    });
  }, [currentFiles, type_param, sortBy, sortOrder, minSize, maxSize]);

  const filteredFolders = useMemo(() => {
    return currentFiles.filter((folder) => {
      if (folder.type !== "folder") return false;
      if (type_param !== "all") return false;
      return true;
    }).sort((a, b) => {
      let comparison = 0;
      if (sortBy === "name") comparison = a.name.localeCompare(b.name);
      else comparison = b.lastModified - a.lastModified;
      return sortOrder === "asc" ? comparison : -comparison;
    });
  }, [currentFiles, type_param, sortBy, sortOrder]);

  const handleUploadMany = (fileList: FileList | File[]) => {
    Array.from(fileList).forEach(file => uploadFile(file, currentFolderId));
  };

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 flex-shrink-0 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <LockKeyOpen size={18} weight="duotone" style={{ color: TEAL }} className="flex-shrink-0" />
          <h2 className="text-base font-semibold text-foreground truncate">{activeVaultName}</h2>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium text-white flex-shrink-0" style={{ backgroundColor: TEAL }}>
            Unlocked
          </span>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-secondary border border-border text-muted-foreground flex-shrink-0">
             Local Only
          </span>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <VaultUploadDropdown
            uploadMany={handleUploadMany}
            uploadFolder={uploadFolder}
            setShowCreateFolder={setShowCreateFolder}
            isFragmented={false}
          />

          <button
            onClick={lockVault}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-secondary border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
          >
            <LockSimple size={15} />
            Lock
          </button>
        </div>
      </div>

      {/* ── Breadcrumbs ── */}
      <Breadcrumbs currentFolderId={currentFolderId} setCurrentFolderId={setCurrentFolderId} />

      <div className="flex flex-col gap-4 mb-4">
        {/* Row 1: Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <FileFilters className="mb-0" />
        </div>

        {/* Row 2: Counts */}
        <div className="flex items-center justify-between px-1 py-1">
          <div className="flex items-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <span className="text-foreground font-semibold">
              {filteredFolders.length}
            </span>
            <span className="ml-1">
              Folder{filteredFolders.length !== 1 ? "s" : ""}
            </span>

            <span className="mx-2 text-border">•</span>

            <span className="text-foreground font-semibold">
              {filteredFiles.length}
            </span>
            <span className="ml-1">
              File{filteredFiles.length !== 1 ? "s" : ""}
            </span>
          </div>

          <LayoutToggle layout={layout} onChange={handleLayoutChange} />
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {filteredFolders.length === 0 && filteredFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
              style={{ backgroundColor: `${TEAL}18` }}
            >
              {type_param === "all" ? (
                <FileText size={28} weight="duotone" style={{ color: TEAL }} />
              ) : (
                <Funnel size={28} weight="duotone" style={{ color: TEAL }} />
              )}
            </div>
            <p className="text-sm font-medium text-foreground mb-1">
              {type_param === "all" ? "This folder is empty" : "No items match your filters"}
            </p>
          </div>
        ) : (
          <>
            {/* ───────────────── LIST VIEW ───────────────── */}
            {layout === "list" && (
              <div className="flex flex-col gap-0.5 overflow-y-auto">
                <div className="flex items-center gap-3 px-3 py-1.5">
                  <div className="w-[18px]" />
                  <p className="flex-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Name
                  </p>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide w-20 text-right pr-20 hidden md:block">
                    Size
                  </p>
                </div>
                <div className="border-t border-border mb-1" />

                {/* Folders */}
                {filteredFolders.length > 0 && (
                  <div className="mb-1">
                    <p className="px-3 py-1 text-xs text-muted-foreground/60 font-medium">Folders</p>
                    {filteredFolders.map((folder) => (
                      <div
                        key={folder.id}
                        className="group flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-accent transition-colors cursor-pointer select-none"
                        onDoubleClick={() => setCurrentFolderId(folder.id)}
                      >
                        <FolderSimple size={18} weight="fill" style={{ color: TEAL }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{folder.name}</p>
                        </div>
                        <div className="flex items-center gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                           <VaultItemMenu
                              type="folder"
                              id={folder.id}
                              name={folder.name}
                              onRename={() => {
                                const newName = prompt("New name:", folder.name);
                                // This would need a renameFolder in useOfflineVault, assuming we can use createFolder for now or just stick to deleting/recreating but rename is better.
                                // For now we keep it identical but rename logic is omitted for simplicity unless requested.
                              }}
                              onDelete={() => { if(confirm('Delete?')) deleteItem(folder); }}
                              onMove={() => {}}
                           />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Files */}
                {filteredFiles.length > 0 && (
                  <div>
                    <p className="px-3 py-1 text-xs text-muted-foreground/60 font-medium">Files</p>
                    {filteredFiles.map((file) => (
                      <div
                        key={file.id}
                        className="group flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-accent transition-colors cursor-pointer select-none"
                      >
                         <div className="relative flex-shrink-0">
                            <FileIcon mimeType={file.contentType || ""} />
                         </div>
                         <div className="flex-1 min-w-0">
                           <p className="text-sm font-medium truncate">{file.name}</p>
                           <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                         </div>
                         <div className="flex items-center gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                            <VaultItemMenu
                              type="file"
                              id={file.id}
                              name={file.name}
                              onRename={() => {}}
                              onDelete={() => { if(confirm('Delete?')) deleteItem(file); }}
                              onMove={() => {}}
                              onDownload={() => downloadFile(file)}
                            />
                         </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ───────────────── GRID VIEW ───────────────── */}
            {layout === "grid" && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 pb-8">
                {/* Folders */}
                {filteredFolders.map((folder) => (
                  <div
                    key={folder.id}
                    onDoubleClick={() => setCurrentFolderId(folder.id)}
                    className="group cursor-pointer rounded-2xl border border-border bg-card hover:shadow-md hover:border-[#2da07a]/30 transition-all select-none overflow-hidden"
                  >
                    <div
                      className="flex items-center justify-center relative"
                      style={{ height: 100, background: `${TEAL}0d` }}
                    >
                      <FolderSimple size={42} weight="fill" style={{ color: TEAL }} />
                      
                      <div className="absolute top-2 right-2 flex gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                        <VaultItemMenu
                          type="folder"
                          id={folder.id}
                          name={folder.name}
                          onRename={() => {}}
                          onDelete={() => { if(confirm('Delete?')) deleteItem(folder); }}
                          onMove={() => {}}
                        />
                      </div>
                    </div>
                    <div className="px-3 py-2.5">
                      <p className="text-xs font-medium text-foreground truncate mb-0.5">
                        {folder.name}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Folder • {formatDate(new Date(folder.lastModified).toISOString())}
                      </p>
                    </div>
                  </div>
                ))}

                {/* Files */}
                {filteredFiles.map((file) => (
                  <div
                    key={file.id}
                    className="group cursor-pointer rounded-2xl border border-border bg-card hover:shadow-md hover:border-[#2da07a]/30 transition-all select-none overflow-hidden"
                  >
                    <div
                      className="flex items-center justify-center relative"
                      style={{ height: 100, background: `${TEAL}0d` }}
                    >
                      <FileIcon mimeType={file.contentType || ""} size={42} />
                      
                      <div className="absolute top-2 right-2 flex gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                        <VaultItemMenu
                          type="file"
                          id={file.id}
                          name={file.name}
                          onRename={() => {}}
                          onDelete={() => { if(confirm('Delete?')) deleteItem(file); }}
                          onMove={() => {}}
                          onDownload={() => downloadFile(file)}
                        />
                      </div>
                    </div>

                    <div className="px-3 py-2.5">
                      <p className="text-xs font-medium text-foreground truncate mb-0.5">
                        {file.name}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {formatBytes(file.size)} • {formatDate(new Date(file.lastModified).toISOString())}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {showCreateFolder && (
        <CreateLocalFolderDialog
          onSuccess={(name) => createFolder(name, currentFolderId)}
          onClose={() => setShowCreateFolder(false)}
        />
      )}
    </div>
  );
}
