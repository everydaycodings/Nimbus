// components/FileGrid.tsx
"use client";

import { useState, useTransition } from "react";
import {
  FolderSimple,
  File,
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
import { RenameDialog } from "@/components/rename";
import { MoveToTrash } from "@/components/MoveToTrash";
import { FilePreviewDialog } from "@/components/FilePreviewDialog";
import { ShareDialog } from "@/components/ShareDialog";
import { useDownload } from "@/hooks/useDownload";
import { useItemActions } from "@/hooks/useItemActions";
import { formatBytes, formatDate } from "@/lib/format";
import { useLayout } from "@/hooks/useLayout";
import { LayoutToggle } from "@/components/ui/LayoutToggle";
import { FileIcon } from "@/components/ui/FileIcon";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
type Layout = "list" | "grid";

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

const TEAL = "#2da07a";


// ── DotsMenu: button + menu together, handles its own positioning ──

function DotsMenu({
  type,
  isStarred,
  showRestore,
  onRename,
  onMove,
  onShare,
  onDownload,
  onStar,
  onTrash,
  onRestore,
  size = 15,
}: {
  type: "file" | "folder";
  isStarred: boolean;
  showRestore?: boolean;
  onRename: () => void;
  onMove: () => void;
  onShare: () => void;
  onDownload: () => void;
  onStar: () => void;
  onTrash: () => void;
  onRestore: () => void;
  size?: number;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
          <DotsThree size={size} weight="bold" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-44">
        {!showRestore ? (
          <>
            <DropdownMenuItem onClick={onRename}>Rename</DropdownMenuItem>
            <DropdownMenuItem onClick={onMove}>Move to...</DropdownMenuItem>
            <DropdownMenuItem onClick={onShare}>Share</DropdownMenuItem>

            {type === "file" && (
              <DropdownMenuItem onClick={onDownload}>
                Download
              </DropdownMenuItem>
            )}

            <DropdownMenuItem onClick={onStar}>
              {isStarred ? "Unstar" : "Star"}
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              onClick={onTrash}
              className="text-red-400 focus:text-red-400"
            >
              Move to trash
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem onClick={onRestore}>
            Restore
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ═══════════════════════════════════════════════════════════════
// LIST ROW — proper React component (capital L)
// ═══════════════════════════════════════════════════════════════
function ListRow({
  id, name, type, meta, isStarred, showRestore, onFolderOpen, onRefresh,
}: {
  id: string; name: string; type: "file" | "folder";
  meta?: { mimeType?: string; size?: number; date: string };
  isStarred: boolean; showRestore?: boolean;
  onFolderOpen?: (id: string, name: string) => void; onRefresh?: () => void;
}) {
  const {
    showMoveDialog, setShowMoveDialog,
    showRenameDialog, setShowRenameDialog,
    showTrashDialog, setShowTrashDialog,
    showPreview, setShowPreview,
    showShare, setShowShare,
    isPending, isDownloading,
    handleStar, handleTrash, handleRestore, handleMainClick, handleDownload
  } = useItemActions({ id, name, type, isStarred, onRefresh });

  return (
    <>
      <div className={cn(
        "group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 hover:bg-accent",
        isPending && "opacity-50 pointer-events-none"
      )}>
        <div className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer" onClick={() => handleMainClick(onFolderOpen)}>
          <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center">
            {type === "folder"
              ? <FolderSimple size={22} weight="fill" style={{ color: TEAL }} />
              : <FileIcon mimeType={meta?.mimeType ?? ""} size={22} />
            }
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{name}</p>
            {meta && (
              <p className="text-xs text-muted-foreground">
                {meta.size !== undefined ? `${formatBytes(meta.size)} · ` : ""}
                {formatDate(meta.date)}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          {!showRestore && (
            <>
              <button onClick={handleStar} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                <Star size={15} weight={isStarred ? "fill" : "regular"} style={isStarred ? { color: TEAL } : {}} className={!isStarred ? "text-muted-foreground" : ""} />
              </button>
              <button onClick={() => setShowShare(true)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                <ShareNetwork size={15} />
              </button>
              {type === "file" && (
                <button onClick={handleDownload} disabled={isDownloading} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                  <DownloadSimple size={15} />
                </button>
              )}
              <button onClick={() => setShowTrashDialog(true)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-red-400 transition-colors">
                <Trash size={15} />
              </button>
            </>
          )}
          {showRestore && (
            <button onClick={handleRestore} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
              <ArrowCounterClockwise size={15} />
            </button>
          )}
          <DotsMenu
            type={type} isStarred={isStarred} showRestore={showRestore}
            onRename={() => setShowRenameDialog(true)} onMove={() => setShowMoveDialog(true)}
            onShare={() => setShowShare(true)} onDownload={handleDownload}
            onStar={handleStar} onTrash={() => setShowTrashDialog(true)} onRestore={handleRestore}
          />
        </div>
      </div>

      {showMoveDialog && <MoveDialog itemId={id} itemName={name} itemType={type} onSuccess={() => onRefresh?.()} onClose={() => setShowMoveDialog(false)} />}
      {showRenameDialog && <RenameDialog id={id} name={name} type={type} onSuccess={() => onRefresh?.()} onClose={() => setShowRenameDialog(false)} />}
      {showTrashDialog && <MoveToTrash id={id} name={name} type={type} onSuccess={() => onRefresh?.()} onClose={() => setShowTrashDialog(false)} />}
      {showShare && <ShareDialog resourceId={id} resourceName={name} resourceType={type} onClose={() => setShowShare(false)} />}
      {showPreview && <FilePreviewDialog fileId={id} fileName={name} mimeType={meta?.mimeType ?? ""} onClose={() => setShowPreview(false)} />}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// GRID CARD — overflow:hidden removed from outer div
// ═══════════════════════════════════════════════════════════════
function GridCard({
  id, name, type, meta, isStarred, showRestore, onFolderOpen, onRefresh,
}: {
  id: string; name: string; type: "file" | "folder";
  meta?: { mimeType?: string; size?: number; date: string };
  isStarred: boolean; showRestore?: boolean;
  onFolderOpen?: (id: string, name: string) => void; onRefresh?: () => void;
}) {
  const {
    showMoveDialog, setShowMoveDialog,
    showRenameDialog, setShowRenameDialog,
    showTrashDialog, setShowTrashDialog,
    showPreview, setShowPreview,
    showShare, setShowShare,
    isPending, isDownloading,
    handleStar, handleTrash, handleRestore, handleMainClick, handleDownload
  } = useItemActions({ id, name, type, isStarred, onRefresh });

  return (
    <>
      {/* ── NO overflow-hidden here — that was clipping the menu ── */}
      <div className={cn(
        "group relative flex flex-col rounded-2xl border border-border bg-card transition-all duration-150 hover:border-[#2da07a]/30 hover:shadow-md",
        isPending && "opacity-50 pointer-events-none"
      )}>
        {/* Thumbnail — separate div with its own overflow-hidden for rounded corners */}
        <div
          className="flex items-center justify-center cursor-pointer select-none rounded-t-2xl overflow-hidden"
          style={{ height: 120, background: type === "folder" ? `${TEAL}0d` : "var(--secondary)" }}
          onClick={() => handleMainClick(onFolderOpen)}
        >
          {type === "folder"
            ? <FolderSimple size={52} weight="fill" style={{ color: TEAL }} />
            : <FileIcon mimeType={meta?.mimeType ?? ""} size={48} />
          }
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-3 py-2.5">
          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => handleMainClick(onFolderOpen)}>
            <p className="text-xs font-medium text-foreground truncate">{name}</p>
            {meta && (
              <p className="text-[10px] text-muted-foreground">
                {meta.size != null
                  ? `${formatBytes(meta.size)} • ${formatDate(meta.date)}`
                  : formatDate(meta.date)}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            {!showRestore && (
              <button onClick={handleStar} className="p-1 rounded-lg hover:bg-muted transition-colors">
                <Star size={13} weight={isStarred ? "fill" : "regular"} style={isStarred ? { color: TEAL } : {}} className={!isStarred ? "text-muted-foreground" : ""} />
              </button>
            )}
            {showRestore && (
              <button onClick={handleRestore} className="p-1 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
                <ArrowCounterClockwise size={13} />
              </button>
            )}
            <DotsMenu
              type={type} isStarred={isStarred} showRestore={showRestore} size={13}
              onRename={() => setShowRenameDialog(true)} onMove={() => setShowMoveDialog(true)}
              onTrash={() => setShowTrashDialog(true)}
              onShare={() => setShowShare(true)} onDownload={handleDownload}
              onStar={handleStar} onRestore={handleRestore}
            />
          </div>
        </div>

        {/* Star badge */}
        {isStarred && (
          <div className="absolute top-2 left-2 w-5 h-5 rounded-full bg-black/30 flex items-center justify-center">
            <Star size={11} weight="fill" style={{ color: TEAL }} />
          </div>
        )}
      </div>

      {showMoveDialog && <MoveDialog itemId={id} itemName={name} itemType={type} onSuccess={() => onRefresh?.()} onClose={() => setShowMoveDialog(false)} />}
      {showRenameDialog && <RenameDialog id={id} name={name} type={type} onSuccess={() => onRefresh?.()} onClose={() => setShowRenameDialog(false)} />}
      {showTrashDialog && <MoveToTrash id={id} name={name} type={type} onSuccess={() => onRefresh?.()} onClose={() => setShowTrashDialog(false)} />}
      {showShare && <ShareDialog resourceId={id} resourceName={name} resourceType={type} onClose={() => setShowShare(false)} />}
      {showPreview && <FilePreviewDialog fileId={id} fileName={name} mimeType={meta?.mimeType ?? ""} onClose={() => setShowPreview(false)} />}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN FileGrid
// ═══════════════════════════════════════════════════════════════
export function FileGrid({
  files, folders, showRestore = false, onFolderOpen, onRefresh,
}: FileGridProps) {
  const { layout, handleLayoutChange } = useLayout("nimbus-layout");

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

  const shared = { showRestore, onFolderOpen, onRefresh };

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {folders.length + files.length} item{folders.length + files.length !== 1 ? "s" : ""}
        </p>
        <LayoutToggle layout={layout} onChange={handleLayoutChange} />
      </div>

      {/* List */}
      {layout === "list" && (
        <div className="flex flex-col">
          <div className="flex items-center gap-3 px-3 py-1.5">
            <div className="w-8" />
            <p className="flex-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">Name</p>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide pr-8">Modified</p>
          </div>
          <div className="border-t border-border mb-1" />
          {folders.length > 0 && (
            <div className="mb-2">
              <p className="px-3 py-1 text-xs text-muted-foreground/60 font-medium">Folders</p>
              {folders.map((f) => <ListRow key={f.id} id={f.id} name={f.name} type="folder" isStarred={f.is_starred} meta={{ date: f.created_at }} {...shared} />)}
            </div>
          )}
          {files.length > 0 && (
            <div>
              <p className="px-3 py-1 text-xs text-muted-foreground/60 font-medium">Files</p>
              {files.map((f) => <ListRow key={f.id} id={f.id} name={f.name} type="file" isStarred={f.is_starred} meta={{ mimeType: f.mime_type, size: f.size, date: f.created_at }} {...shared} />)}
            </div>
          )}
        </div>
      )}

      {/* Grid */}
      {layout === "grid" && (
        <div className="flex flex-col gap-4">
          {folders.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground/60 font-medium mb-2">Folders</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {folders.map((f) => <GridCard key={f.id} id={f.id} name={f.name} type="folder" isStarred={f.is_starred} meta={{ date: f.created_at }} {...shared} />)}
              </div>
            </div>
          )}
          {files.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground/60 font-medium mb-2">Files</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {files.map((f) => <GridCard key={f.id} id={f.id} name={f.name} type="file" isStarred={f.is_starred} meta={{ mimeType: f.mime_type, size: f.size, date: f.created_at }} {...shared} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}