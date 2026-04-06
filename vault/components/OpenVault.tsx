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
import {
  deleteVaultFile,
  renameVaultFile,
  getVaultDownloadUrl,
} from "@/vault/actions/vault.actions";
import { decryptBuffer, decryptFile } from "@/vault/lib/crypto";
import { toast } from "sonner";
import { useVaultUpload } from "@/vault/hooks/useVaultUpload";
import { useVaultFolderUpload } from "@/vault/hooks/useVaultFolderUpload";
import { useVaultDownload, canPreviewVaultFile } from "@/vault/hooks/useVaultDownload";
import { useVaultItemsQuery } from "@/vault/hooks/queries/useVaultQueries";
import { 
  useCreateVaultFolderMutation, 
  useRenameVaultFolderMutation, 
  useRenameVaultFileMutation, 
  useDeleteVaultFolderMutation, 
  useDeleteVaultFileMutation, 
  useDeleteVaultMutation 
} from "@/vault/hooks/queries/useVaultMutations";
import { clearVaultSession } from "@/vault/lib/session";
import { VaultPreviewWrapper } from "@/vault/components/VaultPreviewWrapper";
import VaultMoveDialog from "@/vault/components/VaultMoveDialog";
import VaultItemMenu from "@/vault/components/VaultItemMenu";
import { getQueryClient } from "@/lib/query-client";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import VaultUploadDropdown from "./VaultUploadDropdown";
import DeleteConfirmDialog from "./DeleteConfirmDialog";
import { formatBytes, formatDate } from "@/lib/format";
import { useLayout } from "@/hooks/useLayout";
import { LayoutToggle } from "@/components/ui/LayoutToggle";
import { FileIcon } from "@/components/ui/FileIcon";
import { DetailsDialog } from "@/components/DetailsDialog";
import { VaultNoteEditorDialog } from "@/vault/components/VaultNoteEditorDialog";

const TEAL = "#2da07a";

interface VaultFile {
  id: string;
  name: string;
  original_mime_type: string;
  size: number;
  thumbnail_key?: string | null;
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
  is_fragmented: boolean;
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

function VaultFileThumbnail({
  file,
  getThumbnail,
  className,
  size = 18,
  iconSize
}: {
  file: VaultFile;
  getThumbnail: (id: string, key: string) => Promise<string | null>;
  className?: string;
  size?: number;
  iconSize?: number;
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!file.thumbnail_key) return;

    let mounted = true;
    setLoading(true);

    getThumbnail(file.id, file.thumbnail_key)
      .then((url) => {
        if (mounted && url) setThumbUrl(url);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [file.id, file.thumbnail_key, getThumbnail]);

  const isFullWidth = className?.includes("w-full");
  const containerStyle = {
    width: isFullWidth ? "100%" : size,
    height: size,
  };

  if (thumbUrl) {
    return (
      <div 
        className={cn("relative flex-shrink-0 rounded-lg overflow-hidden bg-secondary border border-border shadow-sm", className)} 
        style={containerStyle}
      >
        <img
          src={thumbUrl}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110 animate-in fade-in"
          alt=""
        />
      </div>
    );
  }

  // Fallback: Centered icon in a div of the same size
  return (
    <div 
       className={cn("flex flex-shrink-0 items-center justify-center rounded-lg bg-secondary/50", className)} 
       style={containerStyle}
    >
        <FileIcon mimeType={file.original_mime_type} size={iconSize || Math.round(size * 0.7)} />
    </div>
  );
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
  const { mutateAsync: createFolder, isPending } = useCreateVaultFolderMutation();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.select(); }, []);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError("Name cannot be empty"); return; }
    setError(null);
    try {
      await createFolder({ vaultId, name: trimmed, parentFolderId });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create folder");
    }
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
  const { mutateAsync: renameFolder } = useRenameVaultFolderMutation();
  const { mutateAsync: renameFile } = useRenameVaultFileMutation();
  const [isPending, setIsPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.select(); }, []);

  const handleRename = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError("Name cannot be empty"); return; }
    if (trimmed === initialName) { onClose(); return; }
    setError(null);
    setIsPending(true);
    try {
      if (type === "folder") {
        await renameFolder({ folderId: targetId, name: trimmed });
      } else {
        await renameFile({ fileId: targetId, name: trimmed });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename");
    } finally {
      setIsPending(false);
    }
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
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [isDragging, setIsDragging] = useState(false);
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
  const [noteEditor, setNoteEditor] = useState<{
    open: boolean;
    id?: string;
    name?: string;
    content?: string;
  }>({ open: false });
  const searchParams = useSearchParams();

  const type = searchParams.get("type") || "all";
  const sortBy = searchParams.get("sortBy") || "created_at";
  const sortOrder = searchParams.get("sortOrder") || "desc";
  const minSize = searchParams.get("minSize") ? Number(searchParams.get("minSize")) : undefined;
  const maxSize = searchParams.get("maxSize") ? Number(searchParams.get("maxSize")) : undefined;

  const { layout, handleLayoutChange } = useLayout("nimbus-layout");

  const queryClient = useQueryClient();
  const { data, isLoading: loading } = useVaultItemsQuery(vault.id, currentFolderId);

  const prefetchFolder = (folderId: string) => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.vaultItems(vault.id, folderId),
      queryFn: async () => {
        const [folders, files] = await Promise.all([
          getVaultFolders(vault.id, folderId),
          getVaultFilesInFolder(vault.id, folderId),
        ]);
        return { folders, files };
      },
      staleTime: 1000 * 30,
    });
  };
  const folders = data?.folders ?? [];
  const files = data?.files ?? [];

  const { uploadMany } = useVaultUpload(vault.id, cryptoKey, {
    parentFolderId: currentFolderId,
    isFragmented: vault.is_fragmented,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.vaultItems(vault.id, currentFolderId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.vaults() });
    },
  });
  const { uploadFolder } = useVaultFolderUpload({
    vaultId: vault.id,
    cryptoKey,
    parentFolderId: currentFolderId,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.vaultItems(vault.id, currentFolderId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.vaults() });
    },
  });
  const { download, downloadFolder, preview, getThumbnail, decrypting, clearPreviewCache } = useVaultDownload(cryptoKey);

  // ── Drag and Drop ───────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const items = Array.from(e.dataTransfer.items || []);
    if (items.length === 0) return;

    // Check for directories
    const hasDirectories = items.some(item => {
      const entry = item.webkitGetAsEntry();
      return entry && entry.isDirectory;
    });

    if (hasDirectories) {
        // If folders are dropped, we use a trick: 
        // Chrome's e.dataTransfer.files doesn't have webkitRelativePath.
        // However, the folder upload input *does*.
        // For simplicity, we'll inform the user or just upload files.
        // But let's try to be smart if possible.
        // Actually, Nimbus's useVaultFolderUpload expects a FileList from a webkitdirectory input.
        // We'll just handle regular files for now to match FileListClient behavior.
        if (e.dataTransfer.files.length > 0) {
            uploadMany(e.dataTransfer.files);
        }
    } else {
        if (e.dataTransfer.files.length > 0) {
            uploadMany(e.dataTransfer.files);
        }
    }
  };



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
        setPreviewing((prev) => (prev && prev.fileId === file.id ? { ...prev, objectUrl } : prev));
      } else {
        setPreviewing((prev) => (prev && prev.fileId === file.id ? null : prev));
      }
    } catch {
      alert("Failed to decrypt file for preview.");
      setPreviewing((prev) => (prev && prev.fileId === file.id ? null : prev));
    } finally {
      setLoadingPreview((prev) => (prev === file.id ? null : prev));
    }
  };

  const handleEditNote = async (file: VaultFile) => {
    setLoadingPreview(file.id);
    try {
      const result = await getVaultDownloadUrl(file.id);
      let content = "";

      if (result.isFragmented && result.fragments) {
        const decryptedChunks: ArrayBuffer[] = [];
        for (const fragment of result.fragments) {
          const res = await fetch(fragment.url);
          if (!res.ok) throw new Error("Failed to fetch fragment");
          const encryptedChunk = await res.arrayBuffer();
          const decryptedChunk = await decryptBuffer(new Uint8Array(encryptedChunk), cryptoKey);
          decryptedChunks.push(decryptedChunk);
        }
        const blob = new Blob(decryptedChunks);
        content = await blob.text();
      } else if (result.url) {
        const res = await fetch(result.url);
        const encryptedBlob = await res.blob();
        const decryptedBlob = await decryptFile(encryptedBlob, cryptoKey, file.original_mime_type);
        content = await decryptedBlob.text();
      }

      setNoteEditor({
        open: true,
        id: file.id,
        name: file.name,
        content: content,
      });
    } catch (err) {
      console.error("Failed to fetch vault note content", err);
      toast.error("Failed to decrypt note for editing");
    } finally {
      setLoadingPreview(null);
    }
  };

  const closePreview = () => {
    // We no longer revoke the objectUrl immediately so that the memory cache can reuse it
    setPreviewing(null);
    setLoadingPreview(null);
  };

  const { mutateAsync: deleteFileMut } = useDeleteVaultFileMutation();
  const { mutateAsync: deleteFolderMut } = useDeleteVaultFolderMutation();
  const { mutateAsync: deleteVaultMut } = useDeleteVaultMutation();

  const confirmDelete = async () => {
    if (!deleteDialog.type) return;

    setDeleting(true);

    try {
      if (deleteDialog.type === "file" && deleteDialog.id) {
        await deleteFileMut(deleteDialog.id);
      }

      if (deleteDialog.type === "folder" && deleteDialog.id) {
        await deleteFolderMut(deleteDialog.id);
      }

      if (deleteDialog.type === "vault") {
        clearPreviewCache();
        clearVaultSession(vault.id);
        await deleteVaultMut(vault.id);
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
    <div 
        className={cn(
            "flex flex-col h-full relative transition-all duration-300",
            isDragging && "bg-[#2da07a]/[0.02]"
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
    >
      {/* ── Drag overlay hint ── */}
      {isDragging && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50 p-6">
          <div className="w-full h-full border-2 border-dashed border-[#2da07a]/40 rounded-[2rem] bg-background/60 backdrop-blur-[2px] flex flex-col items-center justify-center gap-4 transition-all duration-300">
            <div className="w-20 h-20 rounded-full bg-[#2da07a]/10 flex items-center justify-center animate-pulse">
                <CloudArrowUp size={40} style={{ color: TEAL }} weight="duotone" />
            </div>
            <div className="text-center">
                <p className="text-xl font-bold" style={{ color: TEAL }}>Release to Encrypt & Store</p>
                <p className="text-sm text-muted-foreground mt-1">End-to-end encryption starts automatically</p>
            </div>
          </div>
        </div>
      )}
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 flex-shrink-0 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <LockKeyOpen size={18} weight="duotone" style={{ color: TEAL }} className="flex-shrink-0" />
          <h2 className="text-base font-semibold text-foreground truncate">{vault.name}</h2>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium text-white flex-shrink-0" style={{ backgroundColor: TEAL }}>
            Unlocked
          </span>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <VaultUploadDropdown
            uploadMany={uploadMany}
            uploadFolder={uploadFolder}
            setShowCreateFolder={setShowCreateFolder}
            onNewNote={() => setNoteEditor({ open: true })}
            isFragmented={vault.is_fragmented}
          />

          {/* Lock */}
          <button
            onClick={() => { clearPreviewCache(); clearVaultSession(vault.id); onLock(); }}
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
        <div className="flex items-center gap-1 text-sm mb-4 flex-shrink-0 overflow-x-auto scrollbar-hide whitespace-nowrap">
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

      <div className="flex flex-col gap-4 mb-4">
        {/* Row 1: Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <FileFilters className="mb-0" />
        </div>

        {/* Row 2: Counts & Toggle */}
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
                <div className="w-8" />
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
                  <p className="px-3 py-1 text-xs text-muted-foreground/60 font-medium">
                    Folders
                  </p>
                  {filteredFolders.map((folder) => (
                    <div
                      key={folder.id}
                      className="group flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-accent transition-colors cursor-pointer select-none"
                      onDoubleClick={() => openFolder(folder)}
                      onMouseEnter={() => prefetchFolder(folder.id)}
                    >
                      <FolderSimple size={22} weight="fill" style={{ color: TEAL }} />

                      <div
                        className="flex-1 min-w-0"
                      >
                        <p className="text-sm font-medium text-foreground truncate">
                          {folder.name}
                        </p>
                      </div>

                      <div className="flex items-center gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
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
                          onDownload={() => downloadFolder(vault.id, folder.id, folder.name)}
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
                        className="group flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-accent transition-colors cursor-pointer select-none"
                        onClick={() => { if (isPreviewable) handlePreview(file); }}
                      >
                        <div className="relative flex-shrink-0">
                          <VaultFileThumbnail file={file} getThumbnail={getThumbnail} size={22} />
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

                        <div className="flex items-center gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
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
                            onDownload={() => download(file.id, file.name, file.original_mime_type)}
                            onEdit={() => handleEditNote(file)}
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
                        onMouseEnter={() => prefetchFolder(folder.id)}
                        className="group cursor-pointer rounded-2xl border border-border bg-card hover:shadow-md hover:border-[#2da07a]/30 transition-all select-none"
                      >
                        <div
                          className="flex items-center justify-center rounded-t-2xl overflow-hidden"
                          style={{ height: 120, background: `${TEAL}0d` }}
                        >
                          <FolderSimple size={52} weight="fill" style={{ color: TEAL }} />
                        </div>

                        <div className="px-3 py-2.5 flex items-start gap-2">
                          <div className="flex-1 min-w-0 cursor-pointer">
                            <p className="text-xs font-medium text-foreground truncate mb-0.5">
                              {folder.name}
                            </p>
                            <p className="text-[10px] text-muted-foreground mb-1">
                              {formatDate(folder.updated_at || folder.created_at)}
                            </p>
                          </div>
                          <div className="flex items-center gap-0.5 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5" onClick={(e) => e.stopPropagation()}>
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
                              onDownload={() => downloadFolder(vault.id, folder.id, folder.name)}
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
                          className="group rounded-2xl border border-border bg-card hover:shadow-md hover:border-[#2da07a]/30 transition-all cursor-pointer relative select-none"
                          onClick={() => { if (isPreviewable) handlePreview(file); }}
                        >
                          <VaultFileThumbnail 
                            file={file} 
                            getThumbnail={getThumbnail} 
                            size={120} 
                            iconSize={48}
                            className="w-full rounded-b-none border-none shadow-none bg-transparent"
                          />
                          {isPreviewable && (
                            <div className="absolute top-3 right-3 w-6 h-6 bg-black/40 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 shadow-sm">
                              <Eye size={12} weight="bold" className="text-white" />
                            </div>
                          )}

                          <div className="px-3 py-2.5 flex items-start gap-2">
                            <div className="flex-1 min-w-0 flex flex-col gap-1 cursor-pointer">
                              <p className="text-xs font-medium text-foreground truncate mb-0.5">
                                {file.name}
                              </p>
                              <p className="text-[10px] text-muted-foreground mb-1">
                                {formatBytes(file.size)} • {formatDate(file.updated_at || file.created_at)}
                              </p>
                            </div>

                            <div className="flex items-center gap-0.5 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5" onClick={(e) => e.stopPropagation()}>
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
                                onDownload={() => download(file.id, file.name, file.original_mime_type)}
                                onEdit={() => handleEditNote(file)}
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
          onSuccess={() => {}}
          onClose={() => setShowCreateFolder(false)}
        />
      )}

      {renameDialog && (
        <RenameDialog
          type={renameDialog.type}
          targetId={renameDialog.id}
          initialName={renameDialog.initialName}
          onSuccess={() => {}}
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
          onSuccess={() => {}}
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

      {noteEditor.open && (
        <VaultNoteEditorDialog
          id={noteEditor.id}
          name={noteEditor.name}
          initialContent={noteEditor.content}
          vaultId={vault.id}
          cryptoKey={cryptoKey}
          parentFolderId={currentFolderId}
          onSuccess={() => {}}
          onClose={() => setNoteEditor({ open: false })}
        />
      )}
    </div>
  );
}