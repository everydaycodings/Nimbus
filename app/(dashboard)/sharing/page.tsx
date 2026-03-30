// app/(dashboard)/sharing/page.tsx
"use client";

import { useState, useEffect, useCallback, useTransition, useRef } from "react";
import {
  ShareNetwork, FolderSimple, File, Trash,
  Globe, Users, Clock, Link as LinkIcon,
  Image, FilePdf, FileVideo, MusicNote,
  Eye, PencilSimple, Check, Copy, CaretDown,
  DownloadSimple, CopySimple, ArrowSquareIn,
  Funnel,
} from "@phosphor-icons/react";
import { useSearchParams } from "next/navigation";
import { FileFilters } from "@/components/FileFilters";
import {
  getSharedFileDownloadUrl,
  getSharedFolderZip,
} from "@/actions/sharing.dashboard";
import { useSharingQuery } from "@/hooks/queries/useSharingQuery";
import {
  useRevokeShareLinkMutation,
  useRevokeUserPermissionMutation,
  useCopySharedResourceMutation,
} from "@/hooks/mutations/useSharingMutations";
import { FilePreviewDialog } from "@/components/FilePreviewDialog";
import { MoveDialog } from "@/components/MoveDialog";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const TEAL = "#2da07a";

function formatExpiry(expiresAt: string | null): { label: string; urgent: boolean } {
  if (!expiresAt) return { label: "Never expires", urgent: false };
  const exp = new Date(expiresAt);
  const diff = exp.getTime() - Date.now();
  if (diff <= 0) return { label: "Expired", urgent: true };
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (hours < 1) return { label: "< 1 hour", urgent: true };
  if (hours < 24) return { label: `${hours}h left`, urgent: true };
  if (days < 7) return { label: `${days}d left`, urgent: false };
  return { label: exp.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), urgent: false };
}

function formatBytes(b: number) {
  if (!b) return "—";
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(1)} GB`;
}

function ResourceIcon({ type, mimeType, size = 20 }: { type: "file" | "folder"; mimeType?: string; size?: number }) {
  if (type === "folder") return <FolderSimple size={size} weight="fill" style={{ color: TEAL }} />;
  if (!mimeType) return <File size={size} weight="duotone" className="text-muted-foreground" />;
  if (mimeType.startsWith("image/")) return <Image size={size} weight="duotone" className="text-purple-400" />;
  if (mimeType.startsWith("video/")) return <FileVideo size={size} weight="duotone" className="text-blue-400" />;
  if (mimeType.startsWith("audio/")) return <MusicNote size={size} weight="duotone" className="text-pink-400" />;
  if (mimeType === "application/pdf") return <FilePdf size={size} weight="duotone" className="text-red-400" />;
  return <File size={size} weight="duotone" className="text-muted-foreground" />;
}

type Tab = "links" | "people" | "shared-with-me";

interface SharedLink {
  id: string; token: string; role: "viewer" | "editor";
  expires_at: string | null; created_at: string;
  resource_id: string; resource_type: "file" | "folder";
  resource_name: string; mime_type?: string;
}

interface SharedPerson {
  permission_id: string; resource_id: string;
  resource_type: "file" | "folder"; resource_name: string;
  mime_type?: string; role: "viewer" | "editor";
  user_email: string; user_name: string | null; shared_at: string;
}

interface SharedWithMeItem {
  permission_id: string; resource_id: string;
  resource_type: "file" | "folder"; role: "viewer" | "editor";
  shared_at: string; name: string; mime_type?: string;
  size?: number; s3_key?: string;
  owner_email: string; owner_name: string | null;
  tags: any[];
}

// ── Grouped resource type ─────────────────────────────────────
interface GroupedResource {
  resource_id: string;
  resource_type: "file" | "folder";
  resource_name: string;
  mime_type?: string;
  links: SharedLink[];
  people: SharedPerson[];
  tags: any[];
}

function groupByResource(links: SharedLink[], people: SharedPerson[]): GroupedResource[] {
  const map = new Map<string, GroupedResource>();

  for (const l of links) {
    if (!map.has(l.resource_id)) {
      map.set(l.resource_id, { resource_id: l.resource_id, resource_type: l.resource_type, resource_name: l.resource_name, mime_type: l.mime_type, links: [], people: [], tags: (l as any).tags || [] });
    }
    map.get(l.resource_id)!.links.push(l);
  }
  for (const p of people) {
    if (!map.has(p.resource_id)) {
      map.set(p.resource_id, { resource_id: p.resource_id, resource_type: p.resource_type, resource_name: p.resource_name, mime_type: p.mime_type, links: [], people: [], tags: (p as any).tags || [] });
    }
    map.get(p.resource_id)!.people.push(p);
  }

  return [...map.values()];
}

// ── Links dropdown in a card ──────────────────────────────────
function LinksDropdown({
  links, copied, isPending, onCopy, onRevoke,
}: {
  links: SharedLink[]; copied: string | null; isPending: boolean;
  onCopy: (t: string) => void; onRevoke: (id: string) => void;
}) {
  if (links.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors group outline-none">
          <Globe size={11} className="group-hover:text-[#2da07a] transition-colors" />
          {links.length} link{links.length !== 1 ? "s" : ""}
          <CaretDown size={9} className="transition-transform group-aria-expanded:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" sideOffset={10} className="w-64 p-1.5 rounded-xl">
        {links.map((link, idx) => {
          const expiry = formatExpiry(link.expires_at);
          const expired = link.expires_at && new Date(link.expires_at) < new Date();
          return (
            <div key={link.id}>
              {idx > 0 && <DropdownMenuSeparator className="my-1.5 opacity-50" />}
              <div className={cn("px-2 py-2 flex flex-col gap-1.5 rounded-lg transition-colors", expired && "opacity-50")}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded",
                      link.role === "editor" ? "text-amber-400 bg-amber-400/10" : "text-teal-400 bg-teal-400/10"
                    )}>
                      {link.role}
                    </span>
                    <span className={cn(
                      "text-[10px] font-medium",
                      expiry.urgent ? "text-red-400" : "text-muted-foreground"
                    )}>
                      {expiry.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {!expired && (
                      <button 
                        onClick={() => onCopy(link.token)} 
                        className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
                        title="Copy Link"
                      >
                        {copied === link.token ? <Check size={14} style={{ color: TEAL }} /> : <Copy size={14} />}
                      </button>
                    )}
                    <button 
                      onClick={() => onRevoke(link.id)} 
                      disabled={isPending} 
                      className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-all disabled:opacity-50"
                      title="Revoke Link"
                    >
                      <Trash size={14} />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground truncate bg-muted/30 px-2 py-1 rounded border border-border/50">
                  <LinkIcon size={10} className="flex-shrink-0" />
                  <span className="truncate">.../share/{link.token.slice(0, 8)}...</span>
                </div>
              </div>
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── People dropdown in a card ─────────────────────────────────
function PeopleDropdown({
  people, isPending, onRevoke,
}: {
  people: SharedPerson[]; isPending: boolean; onRevoke: (id: string) => void;
}) {

  if (people.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors group outline-none">
          <Users size={11} className="group-hover:text-[#2da07a] transition-colors" />
          {people.length} {people.length === 1 ? "person" : "people"}
          <CaretDown size={9} className="transition-transform group-aria-expanded:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" sideOffset={10} className="w-64 p-1.5 rounded-xl">
        {people.map((p, idx) => (
          <div key={p.permission_id}>
            {idx > 0 && <DropdownMenuSeparator className="my-1.5 opacity-50" />}
            <div className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-muted/50 transition-colors">
              <Avatar className="w-8 h-8 rounded-lg">
                <AvatarFallback className="bg-[#2da07a] text-white text-[11px] font-bold rounded-lg uppercase">
                  {p.user_name ? p.user_name[0] : p.user_email[0]}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-[11px] font-semibold text-foreground leading-none">
                    {p.user_name ?? p.user_email.split("@")[0]}
                  </p>
                  <span className={cn(
                    "text-[9px] font-bold px-1 py-0.5 rounded uppercase leading-none",
                    p.role === "editor" ? "text-amber-400 bg-amber-400/10" : "text-teal-400 bg-teal-400/10"
                  )}>
                    {p.role}
                  </span>
                </div>
                <p className="truncate text-[10px] text-muted-foreground mt-1 leading-none">
                  {p.user_email}
                </p>
              </div>
              <button 
                onClick={() => onRevoke(p.permission_id)} 
                disabled={isPending} 
                className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-all disabled:opacity-50"
                title="Revoke Permission"
              >
                <Trash size={14} />
              </button>
            </div>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Grouped resource card ─────────────────────────────────────
function ResourceCard({
  resource, copied, isPending, onCopy, onRevokeLink, onRevokePerson,
}: {
  resource: GroupedResource;
  copied: string | null;
  isPending: boolean;
  onCopy: (t: string) => void;
  onRevokeLink: (id: string) => void;
  onRevokePerson: (id: string) => void;
}) {
  const hasLinks = resource.links.length > 0;
  const hasPeople = resource.people.length > 0;

  // Check if any link is active
  const activeLinks = resource.links.filter((l) => !l.expires_at || new Date(l.expires_at) >= new Date());

  return (
    <div className="group flex flex-col rounded-2xl border border-border bg-card overflow-visible hover:border-[#2da07a]/30 hover:shadow-md transition-all">
      {/* Thumbnail */}
      <div className="flex items-center justify-center" style={{ height: 96, background: `${TEAL}0d` }}>
        <ResourceIcon type={resource.resource_type} mimeType={resource.mime_type} size={40} />
      </div>

      {/* Body */}
      <div className="flex flex-col gap-2 p-3 flex-1">
        <p className="text-sm font-medium text-foreground truncate">{resource.resource_name}</p>
        <span className="text-[10px] text-muted-foreground capitalize border border-border rounded-full px-2 py-0.5 self-start">
          {resource.resource_type}
        </span>
        {/*
        <div className="flex items-center gap-2 flex-wrap mt-auto">
          {hasLinks && (
            <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
              <Globe size={9} />
              {resource.links.length} link{resource.links.length !== 1 ? "s" : ""}
              {activeLinks.length < resource.links.length && ` (${resource.links.length - activeLinks.length} expired)`}
            </span>
          )}
          {hasPeople && (
            <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
              <Users size={9} />
              {resource.people.length}
            </span>
          )}
        </div>
        */}
      </div>

      {/* Footer with dropdowns */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-border gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <LinksDropdown
            links={resource.links}
            copied={copied}
            isPending={isPending}
            onCopy={onCopy}
            onRevoke={onRevokeLink}
          />
          <PeopleDropdown
            people={resource.people}
            isPending={isPending}
            onRevoke={onRevokePerson}
          />
        </div>
      </div>
    </div>
  );
}

// ── Copy-to-drive dialog (reuses MoveDialog as folder picker) ─
function CopyToDialog({
  item,
  onClose,
  onDone,
}: {
  item: SharedWithMeItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const copyMutation = useCopySharedResourceMutation();
  const copying = copyMutation.isPending;
  const [error, setError] = useState<string | null>(null);

  const handleCopy = (targetFolderId: string | null) => {
    setError(null);
    copyMutation.mutate(
      { resourceId: item.resource_id, resourceType: item.resource_type, targetFolderId },
      {
        onSuccess: () => {
          onDone();
          onClose();
        },
        onError: (err) => {
          setError(err instanceof Error ? err.message : "Copy failed");
        }
      }
    );
  };

  // Reuse MoveDialog UI but for copy
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-xl p-5">
        <h2 className="text-sm font-semibold text-foreground mb-1">Copy to My Drive</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Choose where to save a copy of <span className="font-medium text-foreground">"{item.name}"</span>
        </p>
        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => handleCopy(null)}
            disabled={copying}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm bg-secondary border border-border hover:bg-accent transition-all disabled:opacity-50"
          >
            <FolderSimple size={16} weight="duotone" style={{ color: TEAL }} />
            My Files (root)
          </button>
          <p className="text-[10px] text-muted-foreground text-center">or</p>
          <MoveDialog
            itemId={item.resource_id}
            itemName={item.name}
            itemType={item.resource_type}
            onSuccess={(targetId: string | null) => handleCopy(targetId)}
            onClose={onClose}
            copyMode
          />
        </div>
      </div>
    </div>
  );
}

// ── Shared with me card ───────────────────────────────────────
// Replace the SharedWithMeCard component in sharing/page.tsx with this

function SharedWithMeCard({
  item,
  onRefresh,
}: {
  item: SharedWithMeItem;
  onRefresh: () => void;
}) {
  const [showPreview, setShowPreview] = useState(false);
  const [showCopyTo, setShowCopyTo] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [dlProgress, setDlProgress] = useState<string | null>(null);

  const ownerInitial = item.owner_name
    ? item.owner_name[0].toUpperCase()
    : item.owner_email[0].toUpperCase();

  const handleDownload = async () => {
    setDownloading(true);

    try {
      if (item.resource_type === "file") {
        // ── Single file ──────────────────────────────────────
        const { url, name } = await getSharedFileDownloadUrl(item.resource_id);
        const a = Object.assign(document.createElement("a"), { href: url, download: name });
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

      } else {
        // ── Folder → zip ─────────────────────────────────────
        // Server builds the zip and returns base64
        setDlProgress("Building zip...");
        const { base64, fileName } = await getSharedFolderZip(item.resource_id);

        setDlProgress("Preparing download...");

        // Convert base64 → Uint8Array → Blob
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: "application/zip" });

        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    } catch (err) {
      console.error("[download]", err);
      alert("Download failed. Please try again.");
    } finally {
      setDownloading(false);
      setDlProgress(null);
    }
  };

  return (
    <>
      <div className="group flex flex-col rounded-2xl border border-border bg-card overflow-hidden hover:border-[#2da07a]/30 hover:shadow-md transition-all">
        {/* Thumbnail */}
        <div className="flex items-center justify-center" style={{ height: 96, background: `${TEAL}0d` }}>
          <ResourceIcon type={item.resource_type} mimeType={item.mime_type} size={40} />
        </div>

        {/* Body */}
        <div className="flex flex-col gap-1.5 p-3 flex-1">
          <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
          {item.size && (
            <p className="text-[10px] text-muted-foreground">{formatBytes(item.size)}</p>
          )}

          {/* Role badge */}
          <span className={cn(
            "self-start flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border",
            item.role === "editor"
              ? "text-amber-400 border-amber-400/30 bg-amber-400/10"
              : "text-muted-foreground border-border bg-muted"
          )}>
            {item.role === "editor" ? <PencilSimple size={9} /> : <Eye size={9} />}
            {item.role}
          </span>

          {/* Owner */}
          <div className="flex items-center gap-1.5 mt-1">
            <div
              className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
              style={{ backgroundColor: TEAL }}
            >
              {ownerInitial}
            </div>

            <div className="flex flex-col leading-tight max-w-[120px]">
              <p className="text-[12px] wrap-break-word">
                {item.owner_name ?? "--"}
              </p>
              <p className="text-[10px] text-muted-foreground wrap-break-word">
                {item.owner_email}
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 px-3 py-2 border-t border-border">
          {/* Preview — files only */}
          {item.resource_type === "file" && (
            <button
              onClick={() => setShowPreview(true)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Preview"
            >
              <Eye size={12} />
              Preview
            </button>
          )}

          {/* Download — file or folder zip */}
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            title="Download"
          >
            <DownloadSimple size={12} />
            {downloading
              ? (dlProgress ?? "...")
              : item.resource_type === "folder"
                ? "Download"
                : "Download"
            }
          </button>

          {/* Copy to my drive */}
          <button
            onClick={() => setShowCopyTo(true)}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Copy to my drive"
          >
            <CopySimple size={12} />
            Copy
          </button>
        </div>
      </div>

      {showPreview && item.resource_type === "file" && (
        <FilePreviewDialog
          fileId={item.resource_id}
          fileName={item.name}
          mimeType={item.mime_type ?? ""}
          onClose={() => setShowPreview(false)}
        />
      )}

      {showCopyTo && (
        <CopyToDialog
          item={item}
          onClose={() => setShowCopyTo(false)}
          onDone={onRefresh}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════
export default function SharingPage() {
  const [tab, setTab] = useState<Tab>("links");
  const [copied, setCopied] = useState<string | null>(null);
  const searchParams = useSearchParams();

  const type = searchParams.get("type") || "all";
  const sortBy = searchParams.get("sortBy") || "created_at";
  const sortOrder = searchParams.get("sortOrder") || "desc";
  const minSize = searchParams.get("minSize") ? Number(searchParams.get("minSize")) : undefined;
  const maxSize = searchParams.get("maxSize") ? Number(searchParams.get("maxSize")) : undefined;
  const tagId = searchParams.get("tagId") || undefined;

  const { data, isLoading: loading, refetch: load } = useSharingQuery();
  
  const links = (data?.mine?.links ?? []) as SharedLink[];
  const people = (data?.mine?.people ?? []) as SharedPerson[];
  const sharedWithMe = (data?.withMe ?? []) as SharedWithMeItem[];

  const revokeLinkMutation = useRevokeShareLinkMutation();
  const revokePersonMutation = useRevokeUserPermissionMutation();
  const isPending = revokeLinkMutation.isPending || revokePersonMutation.isPending;

  const copyLink = async (token: string) => {
    await navigator.clipboard.writeText(`${window.location.origin}/share/${token}`);
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleRevokeLink = (id: string) => revokeLinkMutation.mutate(id);
  const handleRevokePerson = (id: string) => revokePersonMutation.mutate(id);

  const grouped = groupByResource(links, people);
  const GRID = "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3";
  const totalActive = links.filter((l) => !l.expires_at || new Date(l.expires_at) >= new Date()).length;
  const totalExpired = links.length - totalActive;

  // Client-side filtering/sorting for Grouped Resources
  const filteredGrouped = grouped.filter((res) => {
    if (type !== "all") {
      if (!res.mime_type) {
        if (res.resource_type === "folder") return false; // Folders are not files
        return false;
      }
      if (type === "image" && !res.mime_type.startsWith("image/")) return false;
      if (type === "video" && !res.mime_type.startsWith("video/")) return false;
      if (type === "audio" && !res.mime_type.startsWith("audio/")) return false;
      if (type === "document") {
        const docs = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"];
        if (!docs.includes(res.mime_type)) return false;
      }
    }
    // Size filter (harder for grouped items as size might not be present for links)
    
    // Tag filter
    if (tagId && !res.tags?.some((t: any) => t.tag.id === tagId)) return false;

    return true;
  }).sort((a, b) => {
    let comparison = 0;
    if (sortBy === "name") comparison = a.resource_name.localeCompare(b.resource_name);
    else comparison = new Date(a.links[0]?.created_at || 0).getTime() - new Date(b.links[0]?.created_at || 0).getTime();
    return sortOrder === "asc" ? comparison : -comparison;
  });

  // Client-side filtering/sorting for Shared With Me
  const filteredSharedWithMe = sharedWithMe.filter((item) => {
    if (type !== "all") {
      if (item.resource_type === "folder") return false;
      if (!item.mime_type) return false;
      if (type === "image" && !item.mime_type.startsWith("image/")) return false;
      if (type === "video" && !item.mime_type.startsWith("video/")) return false;
      if (type === "audio" && !item.mime_type.startsWith("audio/")) return false;
      if (type === "document") {
        const docs = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"];
        if (!docs.includes(item.mime_type)) return false;
      }
    }
    if (minSize !== undefined && (item.size || 0) < minSize) return false;
    if (maxSize !== undefined && (item.size || 0) > maxSize) return false;
    
    // Tag filter
    if (tagId && !item.tags?.some((t: any) => t.tag.id === tagId)) return false;

    return true;
  }).sort((a, b) => {
    let comparison = 0;
    if (sortBy === "name") comparison = a.name.localeCompare(b.name);
    else if (sortBy === "size") comparison = (a.size || 0) - (b.size || 0);
    else comparison = new Date(a.shared_at).getTime() - new Date(b.shared_at).getTime();
    return sortOrder === "asc" ? comparison : -comparison;
  });

  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <ShareNetwork size={22} weight="duotone" style={{ color: TEAL }} />
          Sharing
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Manage everything you've shared and what's been shared with you.
        </p>
      </div>

      {/* Stats */}
      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: "Active links", value: totalActive, icon: Globe },
            { label: "Expired links", value: totalExpired, icon: Clock },
            { label: "People with access", value: people.length, icon: Users },
            { label: "Shared with me", value: sharedWithMe.length, icon: ArrowSquareIn },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="flex flex-col p-3 rounded-xl bg-secondary border border-border">
              <Icon size={15} weight="duotone" className="text-muted-foreground mb-2" />
              <p className="text-xl font-bold text-foreground">{value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <FileFilters />

      {/* Tabs */}
      <div className="flex gap-4 mb-5 border-b border-border overflow-x-auto scrollbar-hide">
        {([
          { key: "links", label: "My shared items", count: filteredGrouped.length },
          { key: "shared-with-me", label: "Shared with me", count: filteredSharedWithMe.length },
        ] as { key: Tab; label: string; count: number }[]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "pb-3 px-1 text-sm font-medium flex items-center gap-1.5 transition-colors border-b-2 -mb-px whitespace-nowrap flex-shrink-0",
              tab === t.key
                ? "border-[#2da07a] text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={tab === t.key
                ? { backgroundColor: TEAL, color: "white" }
                : { backgroundColor: "var(--muted)", color: "var(--muted-foreground)" }
              }
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className={GRID}>
          {[...Array(6)].map((_, i) => <div key={i} className="h-44 rounded-2xl bg-muted animate-pulse" />)}
        </div>
      ) : (
        <>
          {/* ── My shared items ── */}
          {tab === "links" && (
            grouped.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <ShareNetwork size={40} weight="duotone" className="text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">Nothing shared yet</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Share a file or folder to see it here</p>
              </div>
            ) : (
              <div className={GRID}>
                {filteredGrouped.map((resource) => (
                  <ResourceCard
                    key={resource.resource_id}
                    resource={resource}
                    copied={copied}
                    isPending={isPending}
                    onCopy={copyLink}
                    onRevokeLink={handleRevokeLink}
                    onRevokePerson={handleRevokePerson}
                  />
                ))}
              </div>
            )
          )}

          {/* ── Shared with me ── */}
          {tab === "shared-with-me" && (
            sharedWithMe.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <ArrowSquareIn size={40} weight="duotone" className="text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">Nothing shared with you yet</p>
                <p className="text-xs text-muted-foreground/60 mt-1">When someone shares a file or folder with you it appears here</p>
              </div>
            ) : (
              <div className={GRID}>
                {filteredSharedWithMe.map((item) => (
                  <SharedWithMeCard
                    key={item.permission_id}
                    item={item}
                    onRefresh={load}
                  />
                ))}
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}