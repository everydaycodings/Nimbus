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
  ShareNetwork,
  Rows,
  SquaresFour,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { toggleStar, trashItem, restoreItem, renameItem } from "@/actions/files";
import { MoveDialog } from "@/components/MoveDialog";
import { FilePreviewDialog } from "@/components/FilePreviewDialog";
import { ShareDialog } from "@/components/ShareDialog";
import { useDownload } from "@/hooks/useDownload";

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

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function FileIcon({ mimeType, size = 20 }: { mimeType: string; size?: number }) {
  if (mimeType.startsWith("image/")) return <Image size={size} weight="duotone" className="text-purple-400" />;
  if (mimeType.startsWith("video/")) return <FileVideo size={size} weight="duotone" className="text-blue-400" />;
  if (mimeType.startsWith("audio/")) return <MusicNote size={size} weight="duotone" className="text-pink-400" />;
  if (mimeType === "application/pdf") return <FilePdf size={size} weight="duotone" className="text-red-400" />;
  return <File size={size} weight="duotone" className="text-muted-foreground" />;
}

function LayoutToggle({ layout, onChange }: { layout: Layout; onChange: (l: Layout) => void }) {
  return (
    <div className="flex items-center gap-0.5 bg-secondary border border-border rounded-lg p-0.5">
      <button
        onClick={() => onChange("list")}
        className={cn("p-1.5 rounded-md transition-all", layout === "list" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
        title="List view"
      >
        <Rows size={15} />
      </button>
      <button
        onClick={() => onChange("grid")}
        className={cn("p-1.5 rounded-md transition-all", layout === "grid" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
        title="Grid view"
      >
        <SquaresFour size={15} />
      </button>
    </div>
  );
}

// ── Shared context menu rendered in a portal-like fixed div ───
// Fixes the overflow:hidden clipping issue on grid cards
function ContextMenu({
  open, onClose, type, isStarred, showRestore,
  onRename, onMove, onShare, onDownload, onStar, onTrash, onRestore,
}: {
  open: boolean; onClose: () => void;
  type: "file" | "folder"; isStarred: boolean; showRestore?: boolean;
  onRename: () => void; onMove: () => void; onShare: () => void;
  onDownload: () => void; onStar: () => void; onTrash: () => void; onRestore: () => void;
}) {
  if (!open) return null;
  return (
    <>
      {/* Full-screen backdrop to catch outside clicks */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      {/* Menu — fixed positioning so it escapes overflow:hidden on grid cards */}
      <div
        className="fixed z-50 w-44 bg-popover border border-border rounded-xl shadow-xl py-1 text-sm"
        style={{ transform: "translateY(8px)" }}
      // Position is set via CSS trick below — we use absolute on a non-clipped ancestor
      >
        {!showRestore ? (
          <>
            <button onClick={() => { onRename(); onClose(); }} className="w-full text-left px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Rename</button>
            <button onClick={() => { onMove(); onClose(); }} className="w-full text-left px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Move to...</button>
            <button onClick={() => { onShare(); onClose(); }} className="w-full text-left px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Share</button>
            {type === "file" && (
              <button onClick={() => { onDownload(); onClose(); }} className="w-full text-left px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Download</button>
            )}
            <button onClick={() => { onStar(); onClose(); }} className="w-full text-left px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
              {isStarred ? "Unstar" : "Star"}
            </button>
            <div className="my-1 border-t border-border" />
            <button onClick={() => { onTrash(); onClose(); }} className="w-full text-left px-3 py-1.5 text-red-400 hover:bg-accent transition-colors">Move to trash</button>
          </>
        ) : (
          <button onClick={() => { onRestore(); onClose(); }} className="w-full text-left px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Restore</button>
        )}
      </div>
    </>
  );
}

// ── DotsMenu: button + menu together, handles its own positioning ──
function DotsMenu({
  type, isStarred, showRestore,
  onRename, onMove, onShare, onDownload, onStar, onTrash, onRestore,
  size = 15,
}: {
  type: "file" | "folder"; isStarred: boolean; showRestore?: boolean;
  onRename: () => void; onMove: () => void; onShare: () => void;
  onDownload: () => void; onStar: () => void; onTrash: () => void; onRestore: () => void;
  size?: number;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const btnRef = useState<HTMLButtonElement | null>(null);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    // Position the menu below and right-aligned to the button
    setMenuPos({
      top: rect.bottom + window.scrollY + 4,
      left: rect.right + window.scrollX - 176, // 176 = w-44
    });
    setOpen(!open);
  };

  return (
    <>
      <button
        onClick={handleClick}
        className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
      >
        <DotsThree size={size} weight="bold" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed z-50 w-44 bg-popover border border-border rounded-xl shadow-xl py-1 text-sm"
            style={{ top: menuPos.top, left: Math.max(8, menuPos.left) }}
          >
            {!showRestore ? (
              <>
                <button onClick={() => { onRename(); setOpen(false); }} className="w-full text-left px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Rename</button>
                <button onClick={() => { onMove(); setOpen(false); }} className="w-full text-left px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Move to...</button>
                <button onClick={() => { onShare(); setOpen(false); }} className="w-full text-left px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Share</button>
                {type === "file" && (
                  <button onClick={() => { onDownload(); setOpen(false); }} className="w-full text-left px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Download</button>
                )}
                <button onClick={() => { onStar(); setOpen(false); }} className="w-full text-left px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  {isStarred ? "Unstar" : "Star"}
                </button>
                <div className="my-1 border-t border-border" />
                <button onClick={() => { onTrash(); setOpen(false); }} className="w-full text-left px-3 py-1.5 text-red-400 hover:bg-accent transition-colors">Move to trash</button>
              </>
            ) : (
              <button onClick={() => { onRestore(); setOpen(false); }} className="w-full text-left px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">Restore</button>
            )}
          </div>
        </>
      )}
    </>
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
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(name);
  const [isPending, startTransition] = useTransition();
  const { download, downloading } = useDownload();
  const isDownloading = downloading.has(id);

  const handleStar = () => startTransition(async () => { await toggleStar(id, type, isStarred); onRefresh?.(); });
  const handleTrash = () => startTransition(async () => { await trashItem(id, type); onRefresh?.(); });
  const handleRestore = () => startTransition(async () => { await restoreItem(id, type); onRefresh?.(); });
  const handleRename = () => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === name) { setRenaming(false); setNewName(name); return; }
    startTransition(async () => { await renameItem(id, type, trimmed); setRenaming(false); onRefresh?.(); });
  };

  const handleMainClick = () => {
    if (renaming) return;
    if (type === "file") setShowPreview(true);
    if (type === "folder") onFolderOpen?.(id, name);
  };

  return (
    <>
      <div className={cn(
        "group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 hover:bg-accent",
        isPending && "opacity-50 pointer-events-none"
      )}>
        <div className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer" onClick={handleMainClick}>
          <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center">
            {type === "folder"
              ? <FolderSimple size={22} weight="fill" style={{ color: TEAL }} />
              : <FileIcon mimeType={meta?.mimeType ?? ""} size={22} />
            }
          </div>
          <div className="flex-1 min-w-0">
            {renaming ? (
              <input
                autoFocus value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onBlur={handleRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename();
                  if (e.key === "Escape") { setRenaming(false); setNewName(name); }
                }}
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
                <button onClick={() => download(id, name)} disabled={isDownloading} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                  <DownloadSimple size={15} />
                </button>
              )}
              <button onClick={handleTrash} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-red-400 transition-colors">
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
            onRename={() => setRenaming(true)} onMove={() => setShowMoveDialog(true)}
            onShare={() => setShowShare(true)} onDownload={() => download(id, name)}
            onStar={handleStar} onTrash={handleTrash} onRestore={handleRestore}
          />
        </div>
      </div>

      {showMoveDialog && <MoveDialog itemId={id} itemName={name} itemType={type} onSuccess={() => onRefresh?.()} onClose={() => setShowMoveDialog(false)} />}
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
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(name);
  const [isPending, startTransition] = useTransition();
  const { download, downloading } = useDownload();
  const isDownloading = downloading.has(id);

  const handleStar = () => startTransition(async () => { await toggleStar(id, type, isStarred); onRefresh?.(); });
  const handleTrash = () => startTransition(async () => { await trashItem(id, type); onRefresh?.(); });
  const handleRestore = () => startTransition(async () => { await restoreItem(id, type); onRefresh?.(); });
  const handleRename = () => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === name) { setRenaming(false); setNewName(name); return; }
    startTransition(async () => { await renameItem(id, type, trimmed); setRenaming(false); onRefresh?.(); });
  };

  const handleMainClick = () => {
    if (renaming) return;
    if (type === "file") setShowPreview(true);
    if (type === "folder") onFolderOpen?.(id, name);
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
          onClick={handleMainClick}
        >
          {type === "folder"
            ? <FolderSimple size={52} weight="fill" style={{ color: TEAL }} />
            : <FileIcon mimeType={meta?.mimeType ?? ""} size={48} />
          }
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-3 py-2.5">
          <div className="flex-1 min-w-0 cursor-pointer" onClick={handleMainClick}>
            {renaming ? (
              <input
                autoFocus value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onBlur={handleRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename();
                  if (e.key === "Escape") { setRenaming(false); setNewName(name); }
                }}
                onClick={(e) => e.stopPropagation()}
                className="w-full text-xs font-medium bg-secondary border border-[#2da07a]/40 rounded-md px-1.5 py-0.5 text-foreground focus:outline-none"
              />
            ) : (
              <p className="text-xs font-medium text-foreground">{name}</p>
            )}
            {meta && !renaming && (
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
              onRename={() => setRenaming(true)} onMove={() => setShowMoveDialog(true)}
              onShare={() => setShowShare(true)} onDownload={() => download(id, name)}
              onStar={handleStar} onTrash={handleTrash} onRestore={handleRestore}
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
  const [layout, setLayout] = useState<Layout>(
    () => typeof window !== "undefined"
      ? (localStorage.getItem("nimbus-layout") as Layout) ?? "list"
      : "list"
  );

  const handleLayoutChange = (l: Layout) => {
    setLayout(l);
    localStorage.setItem("nimbus-layout", l);
  };

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
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {folders.map((f) => <GridCard key={f.id} id={f.id} name={f.name} type="folder" isStarred={f.is_starred} meta={{ date: f.created_at }} {...shared} />)}
              </div>
            </div>
          )}
          {files.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground/60 font-medium mb-2">Files</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {files.map((f) => <GridCard key={f.id} id={f.id} name={f.name} type="file" isStarred={f.is_starred} meta={{ mimeType: f.mime_type, size: f.size, date: f.created_at }} {...shared} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}