// vault/components/OpenVault.tsx
"use client";

import { useState, useEffect, useCallback, useRef, useTransition } from "react";
import {
  LockKeyOpen, LockSimple, Trash, File,
  Image, FilePdf, FileVideo, MusicNote,
  CloudArrowUp, DownloadSimple, ShieldCheck,
  Eye, FolderSimple, FolderPlus, CaretRight,
  X, House,
} from "@phosphor-icons/react";
import {
  getVaultFolders,
  getVaultFilesInFolder,
  createVaultFolder,
  deleteVaultFolder,
  renameVaultFolder,
} from "@/vault/actions/vault.folders.actions";
import { deleteVaultFile } from "@/vault/actions/vault.actions";
import { useVaultUpload } from "@/vault/hooks/useVaultUpload";
import { useVaultFolderUpload } from "@/vault/hooks/useVaultFolderUpload";
import { useVaultDownload, canPreviewVaultFile } from "@/vault/hooks/useVaultDownload";
import { clearVaultSession } from "@/vault/lib/session";
import { deleteVault } from "@/vault/actions/vault.actions";
import { VaultPreviewWrapper } from "@/vault/components/VaultPreviewWrapper";
import { cn } from "@/lib/utils";
import VaultUploadDropdown from "./VaultUploadDropdown";
import DeleteConfirmDialog from "./DeleteConfirmDialog";
import { formatBytes } from "@/lib/format";
import { useLayout } from "@/hooks/useLayout";
import { LayoutToggle } from "@/components/ui/LayoutToggle";
import { FileIcon } from "@/components/ui/FileIcon";

const TEAL = "#2da07a";

interface VaultFile {
  id: string;
  name: string;
  original_mime_type: string;
  size: number;
  created_at: string;
}

interface VaultFolder {
  id: string;
  name: string;
  created_at: string;
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
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const { layout, handleLayoutChange } = useLayout("vault-layout");

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

  const handleRenameFolder = async (folderId: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed) { setRenamingFolder(null); return; }
    await renameVaultFolder(folderId, trimmed);
    setRenamingFolder(null);
    refresh();
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
        {/* Left: count */}
        <p className="text-xs text-muted-foreground">
          {folders.length + files.length} item
          {folders.length + files.length !== 1 ? "s" : ""}
        </p>

        {/* Right: layout toggle */}
        <LayoutToggle layout={layout} onChange={handleLayoutChange} />
      </div>

      {/* ── Content ── */}
      {loading ? (
        <div className="flex flex-col gap-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-10 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : folders.length === 0 && files.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 py-16 text-center">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
            style={{ backgroundColor: `${TEAL}18` }}
          >
            <ShieldCheck size={28} weight="duotone" style={{ color: TEAL }} />
          </div>
          <p className="text-sm font-medium text-foreground mb-1">
            {currentFolderId ? "Folder is empty" : "Vault is empty"}
          </p>
          <p className="text-xs text-muted-foreground">
            {currentFolderId
              ? "Upload files or create a subfolder"
              : "Add files or create a folder to get started"}
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
              {folders.length > 0 && (
                <div className="mb-1">
                  <p className="px-3 py-1 text-xs text-muted-foreground/60 font-medium">
                    Folders
                  </p>
                  {folders.map((folder) => (
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

                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleDeleteFolder(folder.id)}
                          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-red-400"
                        >
                          <Trash size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Files */}
              {files.length > 0 && (
                <div>
                  <p className="px-3 py-1 text-xs text-muted-foreground/60 font-medium">
                    Files
                  </p>
                  {files.map((file) => {
                    const isPreviewable = canPreviewVaultFile(
                      file.original_mime_type,
                      file.size
                    );

                    return (
                      <div
                        key={file.id}
                        className="group flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-accent transition-colors"
                      >
                        <FileIcon mimeType={file.original_mime_type} />

                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {file.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatBytes(file.size)}
                          </p>
                        </div>

                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {isPreviewable && (
                            <button
                              onClick={() => handlePreview(file)}
                              className="p-1.5 rounded-lg hover:bg-muted"
                            >
                              <Eye size={13} />
                            </button>
                          )}

                          <button
                            onClick={() =>
                              download(file.id, file.name, file.original_mime_type)
                            }
                            className="p-1.5 rounded-lg hover:bg-muted"
                          >
                            <DownloadSimple size={13} />
                          </button>

                          <button
                            onClick={() => handleDeleteFile(file.id)}
                            className="p-1.5 rounded-lg hover:bg-muted text-red-400"
                          >
                            <Trash size={13} />
                          </button>
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
              {folders.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground/60 font-medium mb-2">
                    Folders
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {folders.map((folder) => (
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

                        <div className="px-3 py-2 flex justify-between">
                          <p className="text-xs font-medium truncate">
                            {folder.name}
                          </p>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteFolder(folder.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted"
                          >
                            <Trash size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Files */}
              {files.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground/60 font-medium mb-2">
                    Files
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {files.map((file) => {
                      const isPreviewable = canPreviewVaultFile(
                        file.original_mime_type,
                        file.size
                      );

                      return (
                        <div
                          key={file.id}
                          className="group rounded-2xl border border-border bg-card hover:shadow-md hover:border-[#2da07a]/30 transition-all"
                        >
                          <div
                            className="flex items-center justify-center rounded-t-2xl"
                            style={{ height: 100, background: "var(--secondary)" }}
                          >
                            <FileIcon mimeType={file.original_mime_type} size={40} />
                          </div>

                          <div className="px-3 py-2 flex flex-col gap-1">
                            <p className="text-xs font-medium truncate">
                              {file.name}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {formatBytes(file.size)}
                            </p>

                            <div className="flex gap-1 mt-1 opacity-0 group-hover:opacity-100">
                              {isPreviewable && (
                                <button
                                  onClick={() => handlePreview(file)}
                                  className="p-1 rounded hover:bg-muted"
                                >
                                  <Eye size={12} />
                                </button>
                              )}

                              <button
                                onClick={() =>
                                  download(file.id, file.name, file.original_mime_type)
                                }
                                className="p-1 rounded hover:bg-muted"
                              >
                                <DownloadSimple size={12} />
                              </button>

                              <button
                                onClick={() => handleDeleteFile(file.id)}
                                className="p-1 rounded hover:bg-muted text-red-400"
                              >
                                <Trash size={12} />
                              </button>
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
    </div>
  );
}