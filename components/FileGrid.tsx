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
import { toggleStar, trashItem, restoreItem, renameItem, getFiles } from "@/actions/files";
import { queryKeys } from "@/lib/query-keys";
import { useQueryClient } from "@tanstack/react-query";
import { MoveDialog } from "@/components/MoveDialog";
import { RenameDialog } from "@/components/rename";
import { MoveToTrash } from "@/components/MoveToTrash";
import { FilePreviewDialog } from "@/components/FilePreviewDialog";
import { ShareDialog } from "@/components/ShareDialog";
import { VersionHistoryDialog } from "@/components/VersionHistoryDialog";
import { useDownload } from "@/hooks/useDownload";
import { useItemActions } from "@/hooks/useItemActions";
import { formatDate, formatBytes } from "@/lib/format";
import { useLayout } from "@/hooks/useLayout";
import { LayoutToggle } from "@/components/ui/LayoutToggle";
import { FileIcon } from "@/components/ui/FileIcon";
import { DetailsDialog } from "@/components/DetailsDialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { TagBadge } from "@/components/tags/TagBadge";
import { TagPicker } from "@/components/tags/TagPicker";
import { Tag } from "@/types/tags";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
type Layout = "list" | "grid";

interface FileItem {
  id: string;
  name: string;
  mime_type: string;
  size: number;
  created_at: string;
  is_starred: boolean;
  s3_key: string;
  type?: "file" | "version";
  updated_at?: string;
  tags?: { tag: Tag }[];
  signed_url?: string | null;
  download_url?: string | null;
  thumbnail_url?: string | null;
}

interface FolderItem {
  id: string;
  name: string;
  created_at: string;
  updated_at?: string;
  is_starred: boolean;
  tags?: { tag: Tag }[];
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
  onDetails,
  onTags,
  onVersionHistory,
  onEdit,
  name,
  mimeType,
  size = 15,
}: {
  type: "file" | "folder" | "version";
  isStarred: boolean;
  showRestore?: boolean;
  onRename: () => void;
  onMove: () => void;
  onShare: () => void;
  onDownload: () => void;
  onStar: () => void;
  onTrash: () => void;
  onRestore: () => void;
  onDetails: () => void;
  onTags: () => void;
  onVersionHistory?: () => void;
  onEdit?: () => void;
  name?: string;
  mimeType?: string;
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

            <DropdownMenuItem onClick={onDownload}>
              Download
            </DropdownMenuItem>

            <DropdownMenuItem onClick={onStar}>
              {isStarred ? "Unstar" : "Star"}
            </DropdownMenuItem>
            
            <DropdownMenuItem onClick={onTags}>
              Tags
            </DropdownMenuItem>
            
            {type === "file" && (
              <DropdownMenuItem onClick={onVersionHistory}>
                Version History
              </DropdownMenuItem>
            )}

            {type === "file" && (mimeType === "text/plain" || name?.toLowerCase().endsWith(".txt")) && (
              <DropdownMenuItem onClick={onEdit}>
                Edit
              </DropdownMenuItem>
            )}
            
            <DropdownMenuItem onClick={onDetails}>
              Details
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
  id: string; name: string; type: "file" | "folder" | "version";
  meta?: {
    mimeType?: string;
    size?: number;
    date: string;
    updated_at?: string;
    s3_key?: string;
    signed_url?: string | null;
    download_url?: string | null;
    thumbnail_url?: string | null;
    tags?: { tag: Tag }[];
    onEdit?: () => void;
  };
  isStarred: boolean;
  showRestore?: boolean;
  onFolderOpen?: (id: string, name: string) => void;
  onRefresh?: () => void;
}) {
  const {
    showMoveDialog, setShowMoveDialog,
    showRenameDialog, setShowRenameDialog,
    showTrashDialog, setShowTrashDialog,
    showPreview, setShowPreview,
    showShare, setShowShare,
    showDetails, setShowDetails,
    isPending, isDownloading,
    handleStar, handleTrash, handleRestore, handleMainClick, handleDownload
  } = useItemActions({ id, name, type, isStarred, signedUrl: meta?.signed_url, downloadUrl: meta?.download_url, onRefresh });

  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const queryClient = useQueryClient();
  const [showTagPicker, setShowTagPicker] = useState(false);
  const tags = meta?.tags?.map(t => t.tag) ?? [];

  const prefetchFolder = () => {
    if (type === "folder" && !showRestore) {
      queryClient.prefetchQuery({
        queryKey: queryKeys.files(id),
        queryFn: () => getFiles(id),
        staleTime: 1000 * 30, // 30 seconds
      });
    }
  };

  return (
    <>
      <div className={cn(
        "group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 hover:bg-accent",
        isPending && "opacity-50 pointer-events-none"
      )}>
        <div 
          className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer select-none" 
          onClick={() => type === "file" && handleMainClick(onFolderOpen)}
          onDoubleClick={() => type === "folder" && handleMainClick(onFolderOpen)}
          onMouseEnter={prefetchFolder}
        >
          <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg overflow-hidden">
            {type === "folder"
              ? <FolderSimple size={22} weight="fill" style={{ color: TEAL }} />
              : meta?.thumbnail_url 
                ? <img src={meta.thumbnail_url} alt={name} className="w-full h-full object-cover" />
                : <FileIcon mimeType={meta?.mimeType ?? ""} size={22} />
            }
          </div>
          <div className="flex-1 min-w-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="text-sm font-medium text-foreground truncate cursor-help">{name}</p>
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs break-all">{name}</p>
              </TooltipContent>
            </Tooltip>
            {meta && (
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-xs text-muted-foreground">
                  {meta.size !== undefined ? `${formatBytes(meta.size)} · ` : ""}
                  {formatDate(meta.date)}
                </p>
                {tags.length > 0 && (
                  <div className="flex items-center gap-1 ml-1">
                    {tags.map(tag => <TagBadge key={tag.id} tag={tag} />)}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Quick actions — hidden on mobile, shown on desktop hover */}
          <div className="hidden md:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {!showRestore && (
              <>
                <button onClick={handleStar} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                  <Star size={15} weight={isStarred ? "fill" : "regular"} style={isStarred ? { color: TEAL } : {}} className={!isStarred ? "text-muted-foreground" : ""} />
                </button>
                <button onClick={() => setShowShare(true)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                  <ShareNetwork size={15} />
                </button>
                <button onClick={handleDownload} disabled={isDownloading} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                  <DownloadSimple size={15} />
                </button>
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
          </div>
          {/* DotsMenu — always visible for touch access */}
          <div className="md:opacity-0 md:group-hover:opacity-100 transition-opacity">
            <DotsMenu
              type={type} isStarred={isStarred} showRestore={showRestore}
              onRename={() => setShowRenameDialog(true)} onMove={() => setShowMoveDialog(true)}
              onShare={() => setShowShare(true)} onDownload={handleDownload}
              onStar={handleStar} onTrash={() => setShowTrashDialog(true)} onRestore={handleRestore}
              onDetails={() => setShowDetails(true)} onTags={() => setShowTagPicker(true)}
              onVersionHistory={() => setShowVersionHistory(true)}
              onEdit={meta?.onEdit}
              name={name}
              mimeType={meta?.mimeType}
            />
          </div>
        </div>
      </div>

      {showMoveDialog && <MoveDialog itemId={id} itemName={name} itemType={type as "file" | "folder"} onSuccess={() => onRefresh?.()} onClose={() => setShowMoveDialog(false)} />}
      {showRenameDialog && <RenameDialog id={id} name={name} type={type as "file" | "folder"} onSuccess={() => onRefresh?.()} onClose={() => setShowRenameDialog(false)} />}
      {showTrashDialog && <MoveToTrash id={id} name={name} type={type} onSuccess={() => onRefresh?.()} onClose={() => setShowTrashDialog(false)} />}
      {showShare && <ShareDialog resourceId={id} resourceName={name} resourceType={type as "file" | "folder"} onClose={() => setShowShare(false)} />}
      {showVersionHistory && <VersionHistoryDialog fileId={id} fileName={name} onClose={() => setShowVersionHistory(false)} />}
      {showPreview && <FilePreviewDialog fileId={id} fileName={name} mimeType={meta?.mimeType ?? ""} signedUrl={meta?.signed_url} downloadUrl={meta?.download_url} onClose={() => setShowPreview(false)} />}
      {showDetails && (
        <DetailsDialog
          item={{
            id,
            name,
            type,
            mime_type: meta?.mimeType,
            size: meta?.size,
            created_at: meta?.date ?? "",
            updated_at: meta?.updated_at,
            is_starred: isStarred,
            tags: meta?.tags,
          }}
          onClose={() => setShowDetails(false)}
        />
      )}
      {showTagPicker && (
        <TagPicker
          itemId={id}
          itemType={type as "file" | "folder"}
          currentTagIds={tags.map(t => t.id)}
          onClose={() => setShowTagPicker(false)}
          onSuccess={() => onRefresh?.()}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// GRID CARD — overflow:hidden removed from outer div
// ═══════════════════════════════════════════════════════════════
function GridCard({
  id, name, type, meta, isStarred, showRestore, onFolderOpen, onRefresh,
}: {
  id: string; name: string; type: "file" | "folder" | "version";
  meta?: {
    mimeType?: string;
    size?: number;
    date: string;
    updated_at?: string;
    s3_key?: string;
    signed_url?: string | null;
    download_url?: string | null;
    thumbnail_url?: string | null;
    tags?: { tag: Tag }[];
    onEdit?: () => void;
  };
  isStarred: boolean;
  showRestore?: boolean;
  onFolderOpen?: (id: string, name: string) => void;
  onRefresh?: () => void;
}) {
  const {
    showMoveDialog, setShowMoveDialog,
    showRenameDialog, setShowRenameDialog,
    showTrashDialog, setShowTrashDialog,
    showPreview, setShowPreview,
    showShare, setShowShare,
    showDetails, setShowDetails,
    isPending, isDownloading,
    handleStar, handleTrash, handleRestore, handleMainClick, handleDownload
  } = useItemActions({ id, name, type, isStarred, signedUrl: meta?.signed_url, downloadUrl: meta?.download_url, onRefresh });

  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const queryClient = useQueryClient();
  const [showTagPicker, setShowTagPicker] = useState(false);
  const tags = meta?.tags?.map(t => t.tag) ?? [];

  const prefetchFolder = () => {
    if (type === "folder" && !showRestore) {
      queryClient.prefetchQuery({
        queryKey: queryKeys.files(id),
        queryFn: () => getFiles(id),
        staleTime: 1000 * 30,
      });
    }
  };

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
          onClick={() => type === "file" && handleMainClick(onFolderOpen)}
          onDoubleClick={() => type === "folder" && handleMainClick(onFolderOpen)}
          onMouseEnter={prefetchFolder}
        >
          {type === "folder"
            ? <FolderSimple size={52} weight="fill" style={{ color: TEAL }} />
            : meta?.thumbnail_url 
              ? <img 
                  src={meta.thumbnail_url} 
                  alt={name} 
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110" 
                  loading="lazy"
                />
              : <FileIcon mimeType={meta?.mimeType ?? ""} size={48} />
          }
        </div>

        {/* Footer */}
        <div className="flex items-start gap-2 px-3 py-2.5">
          <div 
            className="flex-1 min-w-0 cursor-pointer select-none" 
            onClick={() => type === "file" && handleMainClick(onFolderOpen)}
            onDoubleClick={() => type === "folder" && handleMainClick(onFolderOpen)}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="text-xs font-medium text-foreground truncate mb-0.5 cursor-help">{name}</p>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start">
                <p className="max-w-xs break-all">{name}</p>
              </TooltipContent>
            </Tooltip>
            {meta && (
              <p className="text-[10px] text-muted-foreground mb-1">
                {meta.size != null
                  ? `${formatBytes(meta.size)} • ${formatDate(meta.date)}`
                  : formatDate(meta.date)}
              </p>
            )}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {tags.slice(0, 2).map(tag => <TagBadge key={tag.id} tag={tag} />)}
                {tags.length > 2 && (
                  <span className="text-[10px] text-muted-foreground self-center ml-0.5">+{tags.length - 2}</span>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-0.5 flex-shrink-0 mt-0.5">
            <div className="hidden md:flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
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
            </div>
            <div className="md:opacity-0 md:group-hover:opacity-100 transition-opacity">
              <DotsMenu
                type={type} isStarred={isStarred} showRestore={showRestore} size={13}
                onRename={() => setShowRenameDialog(true)} onMove={() => setShowMoveDialog(true)}
                onTrash={() => setShowTrashDialog(true)}
                onShare={() => setShowShare(true)} onDownload={handleDownload}
                onStar={handleStar} onRestore={handleRestore}
                onDetails={() => setShowDetails(true)} onTags={() => setShowTagPicker(true)}
                onVersionHistory={() => setShowVersionHistory(true)}
                onEdit={meta?.onEdit}
                name={name}
                mimeType={meta?.mimeType}
              />
            </div>
          </div>
        </div>

        {/* Star badge */}
        {isStarred && (
          <div className="absolute top-2 left-2 w-5 h-5 rounded-full bg-black/30 flex items-center justify-center">
            <Star size={11} weight="fill" style={{ color: TEAL }} />
          </div>
        )}
      </div>

      {showMoveDialog && <MoveDialog itemId={id} itemName={name} itemType={type as "file" | "folder"} onSuccess={() => onRefresh?.()} onClose={() => setShowMoveDialog(false)} />}
      {showRenameDialog && <RenameDialog id={id} name={name} type={type as "file" | "folder"} onSuccess={() => onRefresh?.()} onClose={() => setShowRenameDialog(false)} />}
      {showTrashDialog && <MoveToTrash id={id} name={name} type={type} onSuccess={() => onRefresh?.()} onClose={() => setShowTrashDialog(false)} />}
      {showShare && <ShareDialog resourceId={id} resourceName={name} resourceType={type as "file" | "folder"} onClose={() => setShowShare(false)} />}
      {showVersionHistory && <VersionHistoryDialog fileId={id} fileName={name} onClose={() => setShowVersionHistory(false)} />}
      {showPreview && <FilePreviewDialog fileId={id} fileName={name} mimeType={meta?.mimeType ?? ""} signedUrl={meta?.signed_url} downloadUrl={meta?.download_url} onClose={() => setShowPreview(false)} />}
      {showDetails && (
        <DetailsDialog
          item={{
            id,
            name,
            type,
            mime_type: meta?.mimeType,
            size: meta?.size,
            created_at: meta?.date ?? "",
            updated_at: meta?.updated_at,
            is_starred: isStarred,
            tags: meta?.tags,
          }}
          onClose={() => setShowDetails(false)}
        />
      )}
      {showTagPicker && (
        <TagPicker
          itemId={id}
          itemType={type as "file" | "folder"}
          currentTagIds={tags.map(t => t.id)}
          onClose={() => setShowTagPicker(false)}
          onSuccess={() => onRefresh?.()}
        />
      )}
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
        <div className="flex items-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground">

          <span className="text-foreground font-semibold">
            {folders.length}
          </span>
          <span className="ml-1">
            Folder{folders.length !== 1 ? "s" : ""}
          </span>

          <span className="mx-2 text-border">•</span>

          <span className="text-foreground font-semibold">
            {files.length}
          </span>
          <span className="ml-1">
            File{files.length !== 1 ? "s" : ""}
          </span>

        </div>
        <LayoutToggle layout={layout} onChange={handleLayoutChange} />
      </div>

      {/* List */}
      {layout === "list" && (
        <div className="flex flex-col">
          <div className="flex items-center gap-3 px-3 py-1.5">
            <div className="w-8" />
            <p className="flex-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">Name</p>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide pr-8 hidden md:block">Modified</p>
          </div>
          <div className="border-t border-border mb-1" />
          {folders.length > 0 && (
            <div className="mb-2">
              <p className="px-3 py-1 text-xs text-muted-foreground/60 font-medium">Folders</p>
              {folders.map((f) => <ListRow key={f.id} id={f.id} name={f.name} type="folder" isStarred={f.is_starred} meta={{ date: f.created_at, updated_at: f.updated_at, tags: f.tags }} {...shared} />)}
            </div>
          )}
          {files.length > 0 && (
            <div>
              <p className="px-3 py-1 text-xs text-muted-foreground/60 font-medium">Files</p>
                {files.map((f: any) => <ListRow key={f.id} id={f.id} name={f.name} type={f.type || "file"} isStarred={f.is_starred} meta={{ mimeType: f.mime_type, size: f.size, date: f.created_at, updated_at: f.updated_at, s3_key: f.s3_key, signed_url: f.signed_url, download_url: f.download_url, thumbnail_url: f.thumbnail_url, tags: f.tags, onEdit: f.onEdit }} {...shared} />)}
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
                {folders.map((f) => <GridCard key={f.id} id={f.id} name={f.name} type="folder" isStarred={f.is_starred} meta={{ date: f.created_at, updated_at: f.updated_at, tags: f.tags }} {...shared} />)}
              </div>
            </div>
          )}
          {files.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground/60 font-medium mb-2">Files</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {files.map((f: any) => <GridCard key={f.id} id={f.id} name={f.name} type={f.type || "file"} isStarred={f.is_starred} meta={{ mimeType: f.mime_type, size: f.size, date: f.created_at, updated_at: f.updated_at, s3_key: f.s3_key, signed_url: f.signed_url, download_url: f.download_url, thumbnail_url: f.thumbnail_url, tags: f.tags, onEdit: f.onEdit }} {...shared} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}