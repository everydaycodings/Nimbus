// vault/components/OpenVault.tsx
"use client";

import { useState, useEffect, useCallback, useRef, useTransition } from "react";
import {
  LockKeyOpen, LockSimple, Trash, File,
  Image, FilePdf, FileVideo, MusicNote,
  CloudArrowUp, DownloadSimple, ShieldCheck,
  Eye, FolderSimple, FolderPlus, CaretRight,
  X, House, DotsThreeVertical, PencilSimple,
  Funnel,
} from "@phosphor-icons/react";
import { useSearchParams } from "next/navigation";
import { FileFilters } from "@/components/FileFilters";
import {
  getVaultFolders,
  getVaultFilesInFolder,
  createVaultFolder,
  deleteVaultFolder,
  renameVaultFolder,
} from "@/vault/actions/vault.folders.actions";
import { deleteVaultFile, renameVaultFile } from "@/vault/actions/vault.actions";
import { useVaultUpload } from "@/vault/hooks/useVaultUpload";
import { useVaultFolderUpload } from "@/vault/hooks/useVaultFolderUpload";
import { useVaultDownload, canPreviewVaultFile } from "@/vault/hooks/useVaultDownload";
import { clearVaultSession } from "@/vault/lib/session";
import { deleteVault } from "@/vault/actions/vault.actions";
import { VaultPreviewWrapper } from "@/vault/components/VaultPreviewWrapper";
import VaultMoveDialog from "@/vault/components/VaultMoveDialog";
import VaultItemMenu from "@/vault/components/VaultItemMenu";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import VaultUploadDropdown from "./VaultUploadDropdown";
import DeleteConfirmDialog from "./DeleteConfirmDialog";
import { formatBytes, formatDate } from "@/lib/format";
import { useLayout } from "@/hooks/useLayout";
import { LayoutToggle } from "@/components/ui/LayoutToggle";
import { FileIcon } from "@/components/ui/FileIcon";
import { DetailsDialog } from "@/components/DetailsDialog";

const TEAL = "#2da07a";

interface VaultFile {
  id: string;
  name: string;
  original_mime_type: string;
  size: number;
  created_at: string;
  updated_at?: string;
}

interface VaultFolder {
  id: string;
  name: string;
  created_at: string;
  updated_at?: string;
}

interface Vault {
  id: string;
  name: string;
  salt: string;
  verification_token: string;
}

interface Breadcrumb {
  id: string;
  name: string;
}

interface VaultPreviewState {
  objectUrl: string | null;
  fileName: string;
  mimeType: string;
  fileId: string;
}

// ── Create folder dialog ──────────────────────────────────────
function CreateFolderDialog({
  vaultId,
  parentFolderId,
  onSuccess,
  onClose,
}: {
  vaultId: string;
  parentFolderId: string | null;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.select(); }, []);

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) { setError("Name cannot be empty"); return; }
    setError(null);
    startTransition(async () => {
      try {
        await createVaultFolder(vaultId, trimmed, parentFolderId);
        onSuccess();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create folder");
      }
    });
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
            <h2 className="text-sm font-semibold text-foreground">New folder</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <X size={15} />
          </button>
        </div>

        <input
          ref={inputRef}
          type="text"
          placeholder="Folder name"
          onChange={(e) => { setName(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") onClose(); }}
          className={cn(
            "w-full px-3 py-2 rounded-xl text-sm bg-secondary border text-foreground focus:outline-none focus:ring-1 transition-all",
            error ? "border-red-500/50 focus:ring-red-500/30" : "border-border focus:ring-[#2da07a]/30 focus:border-[#2da07a]/50"
          )}
          disabled={isPending}
        />
        {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={isPending || !name.trim()}
            className={cn(
              "px-4 py-1.5 rounded-xl text-sm font-medium text-white transition-all",
              isPending || !name.trim() ? "opacity-50 cursor-not-allowed" : "hover:opacity-90"
            )}
            style={{ backgroundColor: TEAL }}
          >
            {isPending ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Rename dialog ─────────────────────────────────────────────
function RenameDialog({
  type,
  targetId,
  initialName,
  onSuccess,
  onClose,
}: {
  type: "file" | "folder";
  targetId: string;
  initialName: string;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.select(); }, []);

  const handleRename = () => {
    const trimmed = name.trim();
    if (!trimmed) { setError("Name cannot be empty"); return; }
    if (trimmed === initialName) { onClose(); return; }
    setError(null);
    startTransition(async () => {
      try {
        if (type === "folder") {
          await renameVaultFolder(targetId, trimmed);
        } else {
          await renameVaultFile(targetId, trimmed);
        }
        onSuccess();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to rename");
      }
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <PencilSimple size={16} weight="duotone" style={{ color: TEAL }} />
            <h2 className="text-sm font-semibold text-foreground">Rename {type}</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <X size={15} />
          </button>
        </div>

        <input
          ref={inputRef}
          type="text"
          value={name}
          placeholder="New name"
          onChange={(e) => { setName(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") onClose(); }}
          className={cn(
            "w-full px-3 py-2 rounded-xl text-sm bg-secondary border text-foreground focus:outline-none focus:ring-1 transition-all",
            error ? "border-red-500/50 focus:ring-red-500/30" : "border-border focus:ring-[#2da07a]/30 focus:border-[#2da07a]/50"
          )}
          disabled={isPending}
        />
        {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all">
            Cancel
          </button>
          <button
            onClick={handleRename}
            disabled={isPending || !name.trim()}
            className={cn(
              "px-4 py-1.5 rounded-xl text-sm font-medium text-white transition-all",
              isPending || !name.trim() ? "opacity-50 cursor-not-allowed" : "hover:opacity-90"
            )}
            style={{ backgroundColor: TEAL }}
          >
            {isPending ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main OpenVault component ──────────────────────────────────
export function OpenVault({
  vault,
  cryptoKey,
  onLock,
  onRefreshVaults,
}: {
  vault: Vault;
  cryptoKey: CryptoKey;
  onLock: () => void;
  onRefreshVaults: () => void;
}) {
  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [previewing, setPreviewing] = useState<VaultPreviewState | null>(null);
  const [loadingPreview, setLoadingPreview] = useState<string | null>(null);
  const [renameDialog, setRenameDialog] = useState<{
    type: "file" | "folder";
    id: string;
    initialName: string;
  } | null>(null);
  const [detailsDialog, setDetailsDialog] = useState<{
    id: string;
    name: string;
    type: "file" | "folder";
    mime_type?: string;
    size?: number;
    created_at: string;
    updated_at?: string;
    is_starred: boolean;
  } | null>(null);
  const [moveDialog, setMoveDialog] = useState<{
    id: string;
    name: string;
    type: "file" | "folder";
  } | null>(null);
  const searchParams = useSearchParams();

  const type = searchParams.get("type") || "all";
  const sortBy = searchParams.get("sortBy") || "created_at";
  const sortOrder = searchParams.get("sortOrder") || "desc";
  const minSize = searchParams.get("minSize") ? Number(searchParams.get("minSize")) : undefined;
  const maxSize = searchParams.get("maxSize") ? Number(searchParams.get("maxSize")) : undefined;

  const { layout, handleLayoutChange } = useLayout("nimbus-layout");

  const { uploadMany, uploads } = useVaultUpload(vault.id, cryptoKey);
  const { uploadFolder } = useVaultFolderUpload({
    vaultId: vault.id,
    cryptoKey,
    parentFolderId: currentFolderId,
    onSuccess: () => refresh(),
  });
  const { download, preview, decrypting } = useVaultDownload(cryptoKey);

  const refresh = useCallback(async () => {
    const [f, files] = await Promise.all([
      getVaultFolders(vault.id, currentFolderId),
      getVaultFilesInFolder(vault.id, currentFolderId),
    ]);
    setFolders(f as VaultFolder[]);
    setFiles(files as VaultFile[]);
  }, [vault.id, currentFolderId]);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    if (uploads.every((u) => u.status === "complete" || u.status === "error")) {
      refresh();
    }
  }, [uploads]);

  const [deleteDialog, setDeleteDialog] = useState<{
    type: "file" | "folder" | "vault" | null;
    id?: string;
  }>({ type: null });

  const [deleting, setDeleting] = useState(false);

  // Client-side filtering/sorting for FILES
  const filteredFiles = files.filter((file) => {
    if (type !== "all") {
      if (type === "image" && !file.original_mime_type.startsWith("image/")) return false;
      if (type === "video" && !file.original_mime_type.startsWith("video/")) return false;
      if (type === "audio" && !file.original_mime_type.startsWith("audio/")) return false;
      if (type === "document") {
        const docs = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"];
        if (!docs.includes(file.original_mime_type)) return false;
      }
    }
    if (minSize !== undefined && file.size < minSize) return false;
    if (maxSize !== undefined && file.size > maxSize) return false;
    return true;
  }).sort((a, b) => {
    let comparison = 0;
    if (sortBy === "name") comparison = a.name.localeCompare(b.name);
    else if (sortBy === "size") comparison = a.size - b.size;
    else comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return sortOrder === "asc" ? comparison : -comparison;
  });

  // Client-side filtering/sorting for FOLDERS
  const filteredFolders = folders.filter((folder) => {
    if (type !== "all") return false;
    return true;
  }).sort((a, b) => {
    let comparison = 0;
    if (sortBy === "name") comparison = a.name.localeCompare(b.name);
    else comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return sortOrder === "asc" ? comparison : -comparison;
  });

  // ── Navigation ───────────────────────────────────────────────
  const openFolder = async (folder: VaultFolder) => {
    setBreadcrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
    setCurrentFolderId(folder.id);
  };

  const navigateToRoot = () => {
    setBreadcrumbs([]);
    setCurrentFolderId(null);
  };

  const navigateToBreadcrumb = (index: number) => {
    const crumb = breadcrumbs[index];
    setBreadcrumbs((prev) => prev.slice(0, index + 1));
    setCurrentFolderId(crumb.id);
  };

  // ── Actions ──────────────────────────────────────────────────
  const handleDeleteFile = (fileId: string) => {
    setDeleteDialog({ type: "file", id: fileId });
  };

  const handleDeleteFolder = (folderId: string) => {
    setDeleteDialog({ type: "folder", id: folderId });
  };

  const handleDeleteVaultClick = () => {
    setDeleteDialog({ type: "vault" });
  };

  const handlePreview = async (file: VaultFile) => {
    setLoadingPreview(file.id);
    setPreviewing({ objectUrl: null, fileName: file.name, mimeType: file.original_mime_type, fileId: file.id });
    try {
      const objectUrl = await preview(file.id, file.original_mime_type);
      if (objectUrl) {
        setPreviewing((prev) => prev ? { ...prev, objectUrl } : null);
      } else {
        setPreviewing(null);
      }
    } catch {
      alert("Failed to decrypt file for preview.");
      setPreviewing(null);
    } finally {
      setLoadingPreview(null);
    }
  };

  const closePreview = () => {
    if (previewing?.objectUrl) {
      URL.revokeObjectURL(previewing.objectUrl);
    }
    setPreviewing(null);
    setLoadingPreview(null);
  };

  const confirmDelete = async () => {
    if (!deleteDialog.type) return;

    setDeleting(true);

    try {
      if (deleteDialog.type === "file" && deleteDialog.id) {
        await deleteVaultFile(deleteDialog.id);
        await refresh();
      }

      if (deleteDialog.type === "folder" && deleteDialog.id) {
        await deleteVaultFolder(deleteDialog.id);
        await refresh();
      }

      if (deleteDialog.type === "vault") {
        clearVaultSession(vault.id);
        await deleteVault(vault.id);
        onRefreshVaults();
        onLock();
      }
    } finally {
      setDeleting(false);
      setDeleteDialog({ type: null });
    }
  };

  const folderInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div className="flex items-center gap-2">
          <LockKeyOpen size={18} weight="duotone" style={{ color: TEAL }} />
          <h2 className="text-base font-semibold text-foreground">{vault.name}</h2>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium text-white" style={{ backgroundColor: TEAL }}>
            Unlocked
          </span>
        </div>

        <div className="flex items-center gap-2">
          <VaultUploadDropdown
            uploadMany={uploadMany}
            uploadFolder={uploadFolder}
            setShowCreateFolder={setShowCreateFolder}
          />

          {/* Lock */}
          <button
            onClick={() => { clearVaultSession(vault.id); onLock(); }}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-secondary border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
          >
            <LockSimple size={15} />
            Lock
          </button>

          {/* Delete vault */}
          <button onClick={handleDeleteVaultClick} className="p-2 rounded-xl text-muted-foreground hover:text-red-400 hover:bg-accent transition-colors">
            <Trash size={15} />
          </button>
        </div>
      </div>

      {/* ── Breadcrumbs ── */}
      {(breadcrumbs.length > 0 || true) && (
        <div className="flex items-center gap-1 text-sm mb-4 flex-shrink-0">
          <button
            onClick={navigateToRoot}
            className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            <House size={13} />
            <span>Vault</span>
          </button>
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.id} className="flex items-center gap-1">
              <CaretRight size={11} className="text-muted-foreground" />
              <button
                onClick={() => navigateToBreadcrumb(i)}
                className={cn(
                  "transition-colors",
                  i === breadcrumbs.length - 1
                    ? "text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        {/* Left: filters */}
        <FileFilters />

        {/* Right: layout toggle */}
        <LayoutToggle layout={layout} onChange={handleLayoutChange} />
      </div>

      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        {/* Left: count */}
        <p className="text-xs text-muted-foreground">
          {filteredFolders.length + filteredFiles.length} item
          {filteredFolders.length + filteredFiles.length !== 1 ? "s" : ""}
        </p>

        {/* Right: progress or nothing */}
      </div>

      {/* ── Content ── */}
      {loading ? (
        <div className="flex flex-col gap-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-10 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : filteredFolders.length === 0 && filteredFiles.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 py-16 text-center">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
            style={{ backgroundColor: `${TEAL}18` }}
          >
            <Funnel size={28} weight="duotone" style={{ color: TEAL }} />
          </div>
          <p className="text-sm font-medium text-foreground mb-1">
            No items match your filters
          </p>
        </div>
      ) : (
        <>
          {/* ───────────────── LIST VIEW ───────────────── */}
          {layout === "list" && (
            <div className="flex flex-col gap-0.5 overflow-y-auto">
              {/* Headers */}
              <div className="flex items-center gap-3 px-3 py-1.5">
                <div className="w-[18px]" />
                <p className="flex-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Name
                </p>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide w-20 text-right pr-20">
                  Size
                </p>
              </div>
              <div className="border-t border-border mb-1" />

              {/* Folders */}
              {filteredFolders.length > 0 && (
                <div className="mb-1">
                  <p className="px-3 py-1 text-xs text-muted-foreground/60 font-medium">
                    Folders
                  </p>
                  {filteredFolders.map((folder) => (
                    <div
                      key={folder.id}
                      className="group flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-accent transition-colors cursor-pointer"
                      onDoubleClick={() => openFolder(folder)}
                    >
                      <FolderSimple size={18} weight="fill" style={{ color: TEAL }} />

                      <div
                        className="flex-1 min-w-0"
                        onClick={() => openFolder(folder)}
                      >
                        <p className="text-sm font-medium text-foreground truncate">
                          {folder.name}
                        </p>
                      </div>

                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                        <VaultItemMenu
                          type="folder"
                          id={folder.id}
                          name={folder.name}
                          onRename={() =>
                            setRenameDialog({
                              type: "folder",
                              id: folder.id,
                              initialName: folder.name,
                            })
                          }
                          onMove={() =>
                            setMoveDialog({
                              id: folder.id,
                              name: folder.name,
                              type: "folder",
                            })
                          }
                          onDelete={() => handleDeleteFolder(folder.id)}
                          onDetails={() =>
                            setDetailsDialog({
                              id: folder.id,
                              name: folder.name,
                              type: "folder",
                              created_at: folder.created_at,
                              updated_at: folder.updated_at,
                              is_starred: false,
                            })
                          }
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Files */}
              {filteredFiles.length > 0 && (
                <div>
                  <p className="px-3 py-1 text-xs text-muted-foreground/60 font-medium">
                    Files
                  </p>
                  {filteredFiles.map((file) => {
                    const isPreviewable = canPreviewVaultFile(
                      file.original_mime_type,
                      file.size
                    );

                    return (
                      <div
                        key={file.id}
                        className="group flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-accent transition-colors cursor-pointer"
                        onClick={() => { if (isPreviewable) handlePreview(file); }}
                      >
                        <div className="relative flex-shrink-0">
                          <FileIcon mimeType={file.original_mime_type} />
                          {isPreviewable && (
                            <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-[#2da07a] rounded-full flex items-center justify-center border border-background shadow-sm">
                              <Eye size={8} weight="bold" className="text-white" />
                            </div>
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {file.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatBytes(file.size)}
                          </p>
                        </div>

                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                          <VaultItemMenu
                            type="file"
                            id={file.id}
                            name={file.name}
                            onRename={() =>
                              setRenameDialog({
                                type: "file",
                                id: file.id,
                                initialName: file.name,
                              })
                            }
                            onMove={() =>
                              setMoveDialog({
                                id: file.id,
                                name: file.name,
                                type: "file",
                              })
                            }
                            onDelete={() => handleDeleteFile(file.id)}
                            onDetails={() =>
                              setDetailsDialog({
                                id: file.id,
                                name: file.name,
                                type: "file",
                                mime_type: file.original_mime_type,
                                size: file.size,
                                created_at: file.created_at,
                                updated_at: file.updated_at,
                                is_starred: false,
                              })
                            }
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ───────────────── GRID VIEW ───────────────── */}
          {layout === "grid" && (
            <div className="flex flex-col gap-4 overflow-y-auto">
              {/* Folders */}
              {filteredFolders.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground/60 font-medium mb-2">
                    Folders
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {filteredFolders.map((folder) => (
                      <div
                        key={folder.id}
                        onDoubleClick={() => openFolder(folder)}
                        className="group cursor-pointer rounded-2xl border border-border bg-card hover:shadow-md hover:border-[#2da07a]/30 transition-all"
                      >
                        <div
                          className="flex items-center justify-center rounded-t-2xl"
                          style={{ height: 100, background: `${TEAL}0d` }}
                        >
                          <FolderSimple size={42} weight="fill" style={{ color: TEAL }} />
                        </div>

                        <div className="px-3 py-2.5 flex items-start gap-2">
                          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openFolder(folder)}>
                            <p className="text-xs font-medium text-foreground truncate mb-0.5">
                              {folder.name}
                            </p>
                            <p className="text-[10px] text-muted-foreground mb-1">
                              {formatDate(folder.updated_at || folder.created_at)}
                            </p>
                          </div>
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5" onClick={(e) => e.stopPropagation()}>
                            <VaultItemMenu
                              type="folder"
                              id={folder.id}
                              name={folder.name}
                              onRename={() =>
                                setRenameDialog({
                                  type: "folder",
                                  id: folder.id,
                                  initialName: folder.name,
                                })
                              }
                              onMove={() =>
                                setMoveDialog({
                                  id: folder.id,
                                  name: folder.name,
                                  type: "folder",
                                })
                              }
                              onDelete={() => handleDeleteFolder(folder.id)}
                              onDetails={() =>
                                setDetailsDialog({
                                  id: folder.id,
                                  name: folder.name,
                                  type: "folder",
                                  created_at: folder.created_at,
                                  updated_at: folder.updated_at,
                                  is_starred: false,
                                })
                              }
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Files */}
              {filteredFiles.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground/60 font-medium mb-2">
                    Files
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {filteredFiles.map((file) => {
                      const isPreviewable = canPreviewVaultFile(
                        file.original_mime_type,
                        file.size
                      );

                      return (
                        <div
                          key={file.id}
                          className="group rounded-2xl border border-border bg-card hover:shadow-md hover:border-[#2da07a]/30 transition-all cursor-pointer relative"
                          onClick={() => { if (isPreviewable) handlePreview(file); }}
                        >
                          <div
                            className="flex items-center justify-center rounded-t-2xl relative"
                            style={{ height: 100, background: "var(--secondary)" }}
                          >
                            <FileIcon mimeType={file.original_mime_type} size={40} />
                            {isPreviewable && (
                              <div className="absolute top-3 right-3 w-6 h-6 bg-black/40 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 shadow-sm">
                                <Eye size={12} weight="bold" className="text-white" />
                              </div>
                            )}
                          </div>

                          <div className="px-3 py-2.5 flex items-start gap-2">
                            <div className="flex-1 min-w-0 flex flex-col gap-1 cursor-pointer">
                              <p className="text-xs font-medium text-foreground truncate mb-0.5">
                                {file.name}
                              </p>
                              <p className="text-[10px] text-muted-foreground mb-1">
                                {formatBytes(file.size)} • {formatDate(file.updated_at || file.created_at)}
                              </p>
                            </div>

                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5" onClick={(e) => e.stopPropagation()}>
                              <VaultItemMenu
                                type="file"
                                id={file.id}
                                name={file.name}
                                onRename={() =>
                                  setRenameDialog({
                                    type: "file",
                                    id: file.id,
                                    initialName: file.name,
                                  })
                                }
                                onMove={() =>
                                  setMoveDialog({
                                    id: file.id,
                                    name: file.name,
                                    type: "file",
                                  })
                                }
                                onDelete={() => handleDeleteFile(file.id)}
                                onDetails={() =>
                                  setDetailsDialog({
                                    id: file.id,
                                    name: file.name,
                                    type: "file",
                                    mime_type: file.original_mime_type,
                                    size: file.size,
                                    created_at: file.created_at,
                                    updated_at: file.updated_at,
                                    is_starred: false,
                                  })
                                }
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Dialogs ── */}
      {showCreateFolder && (
        <CreateFolderDialog
          vaultId={vault.id}
          parentFolderId={currentFolderId}
          onSuccess={refresh}
          onClose={() => setShowCreateFolder(false)}
        />
      )}

      {renameDialog && (
        <RenameDialog
          type={renameDialog.type}
          targetId={renameDialog.id}
          initialName={renameDialog.initialName}
          onSuccess={refresh}
          onClose={() => setRenameDialog(null)}
        />
      )}

      <DeleteConfirmDialog
        open={deleteDialog.type !== null}
        loading={deleting}
        title={
          deleteDialog.type === "vault"
            ? "Delete Vault"
            : deleteDialog.type === "folder"
              ? "Delete Folder"
              : "Delete File"
        }
        description={
          deleteDialog.type === "vault"
            ? `Delete vault "${vault.name}"? All encrypted files will be permanently removed.`
            : deleteDialog.type === "folder"
              ? "This folder and all its contents will be permanently deleted."
              : "This file will be permanently deleted."
        }
        onCancel={() => setDeleteDialog({ type: null })}
        onConfirm={confirmDelete}
      />

      {moveDialog && (
        <VaultMoveDialog
          vaultId={vault.id}
          vaultName={vault.name}
          items={[moveDialog]}
          onClose={() => setMoveDialog(null)}
          onSuccess={refresh}
        />
      )}

      {previewing && (
        <VaultPreviewWrapper
          objectUrl={previewing.objectUrl}
          fileName={previewing.fileName}
          mimeType={previewing.mimeType}
          isLoading={Boolean(loadingPreview && loadingPreview === previewing.fileId)}
          onClose={closePreview}
          onDownload={() => download(previewing.fileId, previewing.fileName, previewing.mimeType)}
        />
      )}

      {detailsDialog && (
        <DetailsDialog
          item={detailsDialog}
          onClose={() => setDetailsDialog(null)}
        />
      )}
    </div>
  );
}