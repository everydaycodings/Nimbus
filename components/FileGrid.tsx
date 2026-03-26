// components/FileGrid.tsx
"use client";

import { useState, useTransition } from "react";
import {
  FolderSimple,
  File,
  Image,
  FilePdf,
  VideoIcon,
  MusicNote,
  Star,
  Trash,
  DotsThree,
  ArrowCounterClockwise,
  DownloadSimple,
  ShareNetwork,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { toggleStar, trashItem, restoreItem, renameItem } from "@/actions/files";
import { MoveDialog } from "@/components/MoveDialog";
import { FilePreviewDialog } from "@/components/FilePreviewDialog";
import { ShareDialog } from "@/components/ShareDialog";
import { useDownload } from "@/hooks/useDownload";

interface FileItem {
  id:         string;
  name:       string;
  mime_type:  string;
  size:       number;
  created_at: string;
  is_starred: boolean;
  s3_key:     string;
}

interface FolderItem {
  id:         string;
  name:       string;
  created_at: string;
  is_starred: boolean;
}

interface FileGridProps {
  files:         FileItem[];
  folders:       FolderItem[];
  showRestore?:  boolean;
  onFolderOpen?: (id: string, name: string) => void;
  onRefresh?:    () => void;
}

function formatBytes(bytes: number) {
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1024 ** 2)  return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3)  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day:   "numeric",
    year:  "numeric",
  });
}

function FileIcon({ mimeType, size = 20 }: { mimeType: string; size?: number }) {
  if (mimeType.startsWith("image/"))  return <Image     size={size} weight="duotone" className="text-purple-400" />;
  if (mimeType.startsWith("video/"))  return <VideoIcon  size={size} weight="duotone" className="text-blue-400" />;
  if (mimeType.startsWith("audio/"))  return <MusicNote  size={size} weight="duotone" className="text-pink-400" />;
  if (mimeType === "application/pdf") return <FilePdf    size={size} weight="duotone" className="text-red-400" />;
  return <File size={size} weight="duotone" className="text-muted-foreground" />;
}

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
  id:            string;
  name:          string;
  type:          "file" | "folder";
  meta?:         { mimeType?: string; size?: number; date: string };
  isStarred:     boolean;
  showRestore?:  boolean;
  onFolderOpen?: (id: string, name: string) => void;
  onRefresh?:    () => void;
}) {
  const [menuOpen,       setMenuOpen]       = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [showPreview,    setShowPreview]    = useState(false);
  const [showShare,      setShowShare]      = useState(false);
  const [renaming,       setRenaming]       = useState(false);
  const [newName,        setNewName]        = useState(name);
  const [isPending,      startTransition]   = useTransition();

  const { download, downloading } = useDownload();
  const isDownloading = downloading.has(id);

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

  // ── What happens when the clickable area (icon + name) is clicked ──
  const handleMainClick = () => {
    if (renaming) return;
    if (type === "file")   setShowPreview(true);
    if (type === "folder") onFolderOpen?.(id, name);
  };

  return (
    <>
      {/* Outer row — NO onClick here, just layout + hover group */}
      <div
        className={cn(
          "group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 hover:bg-accent",
          isPending && "opacity-50 pointer-events-none"
        )}
      >
        {/* ── Clickable area: icon + name only ── */}
        <div
          className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
          onClick={handleMainClick}
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
                  if (e.key === "Enter")  handleRename();
                  if (e.key === "Escape") { setRenaming(false); setNewName(name); }
                }}
                // Stop click from bubbling to the clickable area
                onClick={(e) => e.stopPropagation()}
                className="w-full text-sm font-medium bg-secondary border border-[#2da07a]/40 rounded-lg px-2 py-0.5 text-foreground focus:outline-none focus:ring-1 focus:ring-[#2da07a]/30"
              />
            ) : (
              <p className="text-sm font-medium text-foreground truncate">{name}</p>
            )}
            {meta && !renaming && (
              <p className="text-xs text-muted-foreground">
                {meta.size !== undefined ? `${formatBytes(meta.size)} · ` : ""}
                {formatDate(meta.date)}
              </p>
            )}
          </div>
        </div>

        {/* ── Actions — completely separate from clickable area ── */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          {!showRestore && (
            <>
              <button
                onClick={handleStar}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                title={isStarred ? "Unstar" : "Star"}
              >
                <Star
                  size={15}
                  weight={isStarred ? "fill" : "regular"}
                  className={isStarred ? "text-[#2da07a]" : "text-muted-foreground"}
                />
              </button>

              <button
                onClick={() => setShowShare(true)}
                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Share"
              >
                <ShareNetwork size={15} />
              </button>

              {type === "file" && (
                <button
                  onClick={() => download(id, name)}
                  disabled={isDownloading}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  title="Download"
                >
                  <DownloadSimple size={15} />
                </button>
              )}

              <button
                onClick={handleTrash}
                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-red-400 transition-colors"
                title="Move to trash"
              >
                <Trash size={15} />
              </button>
            </>
          )}

          {showRestore && (
            <button
              onClick={handleRestore}
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Restore"
            >
              <ArrowCounterClockwise size={15} />
            </button>
          )}

          {/* Context menu */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <DotsThree size={15} weight="bold" />
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-8 z-20 w-44 bg-popover border border-border rounded-xl shadow-lg py-1 text-sm">
                  {!showRestore ? (
                    <>
                      <button
                        onClick={() => { setRenaming(true); setMenuOpen(false); }}
                        className="w-full text-left px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      >
                        Rename
                      </button>
                      <button
                        onClick={() => { setShowMoveDialog(true); setMenuOpen(false); }}
                        className="w-full text-left px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      >
                        Move to...
                      </button>
                      <button
                        onClick={() => { setShowShare(true); setMenuOpen(false); }}
                        className="w-full text-left px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      >
                        Share
                      </button>
                      {type === "file" && (
                        <button
                          onClick={() => { download(id, name); setMenuOpen(false); }}
                          className="w-full text-left px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        >
                          Download
                        </button>
                      )}
                      <button
                        onClick={() => { handleStar(); setMenuOpen(false); }}
                        className="w-full text-left px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      >
                        {isStarred ? "Unstar" : "Star"}
                      </button>
                      <div className="my-1 border-t border-border" />
                      <button
                        onClick={() => { handleTrash(); setMenuOpen(false); }}
                        className="w-full text-left px-3 py-1.5 text-red-400 hover:bg-accent transition-colors"
                      >
                        Move to trash
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => { handleRestore(); setMenuOpen(false); }}
                      className="w-full text-left px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
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

      {/* Dialogs */}
      {showMoveDialog && (
        <MoveDialog
          itemId={id}
          itemName={name}
          itemType={type}
          onSuccess={() => onRefresh?.()}
          onClose={() => setShowMoveDialog(false)}
        />
      )}
      {showShare && (
        <ShareDialog
          resourceId={id}
          resourceName={name}
          resourceType={type}
          onClose={() => setShowShare(false)}
        />
      )}
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
        <p className="text-xs text-muted-foreground/60 mt-1">Upload something to get started</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Column headers */}
      <div className="flex items-center gap-3 px-3 py-1.5 mb-1">
        <div className="w-8" />
        <p className="flex-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">Name</p>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide pr-8">Modified</p>
      </div>
      <div className="border-t border-border mb-1" />

      {folders.length > 0 && (
        <div className="mb-2">
          <p className="px-3 py-1 text-xs text-muted-foreground/60 font-medium">Folders</p>
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
        </div>
      )}

      {files.length > 0 && (
        <div>
          <p className="px-3 py-1 text-xs text-muted-foreground/60 font-medium">Files</p>
          {files.map((file) => (
            <ItemRow
              key={file.id}
              id={file.id}
              name={file.name}
              type="file"
              isStarred={file.is_starred}
              meta={{
                mimeType: file.mime_type,
                size:     file.size,
                date:     file.created_at,
              }}
              showRestore={showRestore}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}