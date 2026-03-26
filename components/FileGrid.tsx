// components/FileGrid.tsx
"use client";

import { useState, useTransition } from "react";
import {
  FolderSimple,
  File,
  Image,
  FilePdf,
  FileVideo,
  MusicNote,
  Star,
  Trash,
  DotsThree,
  ArrowCounterClockwise,
  DownloadSimple,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { toggleStar, trashItem, restoreItem, renameItem } from "@/actions/files";
import { MoveDialog } from "@/components/MoveDialog";
import { FilePreviewDialog } from "@/components/FilePreviewDialog";
import { useDownload } from "@/hooks/useDownload";
import { ShareNetwork } from "@phosphor-icons/react";
import { ShareDialog } from "@/components/ShareDialog";

// ── Types ─────────────────────────────────────────────────────
interface FileItem {
  id: string;
  name: string;
  mime_type: string;
  size: number;
  created_at: string;
  is_starred: boolean;
  s3_key: string;
}

interface FolderItem {
  id: string;
  name: string;
  created_at: string;
  is_starred: boolean;
}

interface FileGridProps {
  files: FileItem[];
  folders: FolderItem[];
  showRestore?: boolean;
  onFolderOpen?: (id: string, name: string) => void;
  onRefresh?: () => void;
}

// ── Helpers ───────────────────────────────────────────────────
function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function FileIcon({ mimeType, size = 20 }: { mimeType: string; size?: number }) {
  if (mimeType.startsWith("image/"))
    return <Image size={size} weight="duotone" className="text-purple-400" />;
  if (mimeType.startsWith("video/"))
    return <FileVideo size={size} weight="duotone" className="text-blue-400" />;
  if (mimeType.startsWith("audio/"))
    return <MusicNote size={size} weight="duotone" className="text-pink-400" />;
  if (mimeType === "application/pdf")
    return <FilePdf size={size} weight="duotone" className="text-red-400" />;
  return <File size={size} weight="duotone" className="text-muted-foreground" />;
}

// ── Row ───────────────────────────────────────────────────────
function ItemRow({
  id,
  name,
  type,
  meta,
  isStarred,
  showRestore,
  onFolderOpen,
  onRefresh,
}: {
  id: string;
  name: string;
  type: "file" | "folder";
  meta?: { mimeType?: string; size?: number; date: string };
  isStarred: boolean;
  showRestore?: boolean;
  onFolderOpen?: (id: string, name: string) => void;
  onRefresh?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(name);
  const [isPending, startTransition] = useTransition();

  // ✅ NEW
  const [showPreview, setShowPreview] = useState(false);
  const { download, downloading } = useDownload();
  const isDownloading = downloading.has(id);
  const [showShareDialog, setShowShareDialog] = useState(false);

  const handleStar = () => {
    startTransition(async () => {
      await toggleStar(id, type, isStarred);
      onRefresh?.();
    });
  };

  const handleTrash = () => {
    startTransition(async () => {
      await trashItem(id, type);
      onRefresh?.();
    });
  };

  const handleRestore = () => {
    startTransition(async () => {
      await restoreItem(id, type);
      onRefresh?.();
    });
  };

  const handleRename = () => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === name) {
      setRenaming(false);
      setNewName(name);
      return;
    }
    startTransition(async () => {
      await renameItem(id, type, trimmed);
      setRenaming(false);
      onRefresh?.();
    });
  };

  return (
    <>
      <div
        className={cn(
          "group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150",
          "hover:bg-accent cursor-pointer",
          isPending && "opacity-50 pointer-events-none"
        )}
        // ✅ SINGLE CLICK → PREVIEW
        onClick={() => {
          if (type === "file" && !renaming) setShowPreview(true);
        }}
        onDoubleClick={() => {
          if (type === "folder" && !renaming) onFolderOpen?.(id, name);
        }}
      >
        {/* Icon */}
        <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center">
          {type === "folder" ? (
            <FolderSimple size={22} weight="fill" className="text-[#2da07a]" />
          ) : (
            <FileIcon mimeType={meta?.mimeType ?? ""} size={22} />
          )}
        </div>

        {/* Name + meta */}
        <div className="flex-1 min-w-0">
          {renaming ? (
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={handleRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
                if (e.key === "Escape") {
                  setRenaming(false);
                  setNewName(name);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-full text-sm font-medium bg-secondary border border-[#2da07a]/40 rounded-lg px-2 py-0.5 text-foreground focus:outline-none focus:ring-1 focus:ring-[#2da07a]/30"
            />
          ) : (
            <p
              className="text-sm font-medium text-foreground truncate"
              onDoubleClick={() => !showRestore && setRenaming(true)}
            >
              {name}
            </p>
          )}

          {meta && !renaming && (
            <p className="text-xs text-muted-foreground">
              {meta.size !== undefined ? `${formatBytes(meta.size)} · ` : ""}
              {formatDate(meta.date)}
            </p>
          )}
        </div>

        {/* Hover actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {!showRestore && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleStar();
                }}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors"
              >
                <Star
                  size={15}
                  weight={isStarred ? "fill" : "regular"}
                  className={isStarred ? "text-[#2da07a]" : "text-muted-foreground"}
                />
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleTrash();
                }}
                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-red-400"
              >
                <Trash size={15} />
              </button>
            </>
          )}
          {!showRestore && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowShareDialog(true); }}
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Share"
            >
              <ShareNetwork size={15} />
            </button>
          )}

          {/* ✅ DOWNLOAD BUTTON */}
          {type === "file" && !showRestore && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                download(id, name);
              }}
              disabled={isDownloading}
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
            >
              <DownloadSimple size={15} />
            </button>
          )}

          {showRestore && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleRestore();
              }}
              className="p-1.5 rounded-lg hover:bg-muted"
            >
              <ArrowCounterClockwise size={15} />
            </button>
          )}

          {/* Context menu */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(!menuOpen);
              }}
              className="p-1.5 rounded-lg hover:bg-muted"
            >
              <DotsThree size={15} weight="bold" />
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-8 z-20 w-44 bg-popover border border-border rounded-xl shadow-lg py-1 text-sm">
                  {!showRestore && (
                    <>
                      <button
                        onClick={() => {
                          setRenaming(true);
                          setMenuOpen(false);
                        }}
                        className="w-full text-left px-3 py-1.5 hover:bg-accent"
                      >
                        Rename
                      </button>

                      <button
                        onClick={() => {
                          setShowMoveDialog(true);
                          setMenuOpen(false);
                        }}
                        className="w-full text-left px-3 py-1.5 hover:bg-accent"
                      >
                        Move to...
                      </button>

                      <button
                        onClick={() => { setShowShareDialog(true); setMenuOpen(false); }}
                        className="w-full text-left px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      >
                        Share
                      </button>

                      {/* ✅ CONTEXT DOWNLOAD */}
                      {type === "file" && (
                        <button
                          onClick={() => {
                            download(id, name);
                            setMenuOpen(false);
                          }}
                          className="w-full text-left px-3 py-1.5 hover:bg-accent"
                        >
                          Download
                        </button>
                      )}

                      <button
                        onClick={() => {
                          handleStar();
                          setMenuOpen(false);
                        }}
                        className="w-full text-left px-3 py-1.5 hover:bg-accent"
                      >
                        {isStarred ? "Unstar" : "Star"}
                      </button>

                      <div className="my-1 border-t border-border" />

                      <button
                        onClick={() => {
                          handleTrash();
                          setMenuOpen(false);
                        }}
                        className="w-full text-left px-3 py-1.5 text-red-400 hover:bg-accent"
                      >
                        Move to trash
                      </button>
                    </>
                  )}

                  {showRestore && (
                    <button
                      onClick={() => {
                        handleRestore();
                        setMenuOpen(false);
                      }}
                      className="w-full text-left px-3 py-1.5 hover:bg-accent"
                    >
                      Restore
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Move dialog */}
      {showMoveDialog && (
        <MoveDialog
          itemId={id}
          itemName={name}
          itemType={type}
          onSuccess={() => onRefresh?.()}
          onClose={() => setShowMoveDialog(false)}
        />
      )}

      {showShareDialog && (
        <ShareDialog
          resourceId={id}
          resourceName={name}
          resourceType={type}
          onClose={() => setShowShareDialog(false)}
        />
      )}

      {/* ✅ PREVIEW DIALOG */}
      {showPreview && (
        <FilePreviewDialog
          fileId={id}
          fileName={name}
          mimeType={meta?.mimeType ?? ""}
          onClose={() => setShowPreview(false)}
        />
      )}
    </>
  );
}

// ── Main FileGrid ─────────────────────────────────────────────
export function FileGrid({
  files,
  folders,
  showRestore = false,
  onFolderOpen,
  onRefresh,
}: FileGridProps) {
  const isEmpty = files.length === 0 && folders.length === 0;

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <FolderSimple size={48} weight="duotone" className="text-muted-foreground/40 mb-3" />
        <p className="text-sm text-muted-foreground">No files here yet</p>
        <p className="text-xs text-muted-foreground/60 mt-1">
          Upload something to get started
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {folders.map((folder) => (
        <ItemRow
          key={folder.id}
          id={folder.id}
          name={folder.name}
          type="folder"
          isStarred={folder.is_starred}
          meta={{ date: folder.created_at }}
          showRestore={showRestore}
          onFolderOpen={onFolderOpen}
          onRefresh={onRefresh}
        />
      ))}

      {files.map((file) => (
        <ItemRow
          key={file.id}
          id={file.id}
          name={file.name}
          type="file"
          isStarred={file.is_starred}
          meta={{
            mimeType: file.mime_type,
            size: file.size,
            date: file.created_at,
          }}
          showRestore={showRestore}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  );
}