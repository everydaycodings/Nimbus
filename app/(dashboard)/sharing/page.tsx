// app/(dashboard)/sharing/page.tsx
"use client";

import { useState, useEffect, useCallback, useTransition } from "react";
import {
  ShareNetwork, FolderSimple, File, Trash,
  Globe, Users, Clock, Link as LinkIcon,
  Image, FilePdf, FileVideo, MusicNote,
  Eye, PencilSimple, Check, Copy,
} from "@phosphor-icons/react";
import {
  getMySharedItems,
  revokeShareLink,
  revokeUserPermission,
} from "@/actions/sharing.dashboard";
import { cn } from "@/lib/utils";

const TEAL = "#2da07a";

function formatExpiry(expiresAt: string | null): { label: string; urgent: boolean } {
  if (!expiresAt) return { label: "Never expires", urgent: false };
  const exp  = new Date(expiresAt);
  const diff = exp.getTime() - Date.now();
  if (diff <= 0) return { label: "Expired", urgent: true };
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (hours < 1)  return { label: "< 1 hour",      urgent: true  };
  if (hours < 24) return { label: `${hours}h left`, urgent: true  };
  if (days  < 7)  return { label: `${days}d left`,  urgent: false };
  return {
    label: exp.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    urgent: false,
  };
}

function ResourceIcon({ type, mimeType, size = 20 }: { type: "file" | "folder"; mimeType?: string; size?: number }) {
  if (type === "folder")              return <FolderSimple size={size} weight="fill"   style={{ color: TEAL }} />;
  if (!mimeType)                      return <File         size={size} weight="duotone" className="text-muted-foreground" />;
  if (mimeType.startsWith("image/"))  return <Image        size={size} weight="duotone" className="text-purple-400" />;
  if (mimeType.startsWith("video/"))  return <FileVideo    size={size} weight="duotone" className="text-blue-400" />;
  if (mimeType.startsWith("audio/"))  return <MusicNote    size={size} weight="duotone" className="text-pink-400" />;
  if (mimeType === "application/pdf") return <FilePdf      size={size} weight="duotone" className="text-red-400" />;
  return <File size={size} weight="duotone" className="text-muted-foreground" />;
}

type Tab = "links" | "people";

interface SharedLink {
  id:            string;
  token:         string;
  role:          "viewer" | "editor";
  expires_at:    string | null;
  created_at:    string;
  resource_id:   string;
  resource_type: "file" | "folder";
  resource_name: string;
  mime_type?:    string;
}

interface SharedWithUser {
  permission_id: string;
  resource_id:   string;
  resource_type: "file" | "folder";
  resource_name: string;
  mime_type?:    string;
  role:          "viewer" | "editor";
  user_email:    string;
  user_name:     string | null;
  shared_at:     string;
}

// ── Link card ─────────────────────────────────────────────────
function LinkCard({
  link,
  copied,
  isPending,
  onCopy,
  onRevoke,
}: {
  link:      SharedLink;
  copied:    string | null;
  isPending: boolean;
  onCopy:    (token: string) => void;
  onRevoke:  (id: string)    => void;
}) {
  const expiry   = formatExpiry(link.expires_at);
  const expired  = link.expires_at && new Date(link.expires_at) < new Date();

  return (
    <div className={cn(
      "group relative flex flex-col rounded-2xl border bg-card overflow-hidden transition-all",
      expired
        ? "border-border opacity-60"
        : "border-border hover:border-[#2da07a]/30 hover:shadow-md"
    )}>
      {/* Thumbnail area */}
      <div
        className="flex items-center justify-center"
        style={{
          height: 96,
          background: expired ? "var(--muted)" : `${TEAL}0d`,
        }}
      >
        <ResourceIcon type={link.resource_type} mimeType={link.mime_type} size={40} />
      </div>

      {/* Body */}
      <div className="flex flex-col gap-2 p-3 flex-1">
        <p className="text-sm font-medium text-foreground truncate">{link.resource_name}</p>

        {/* Role badge */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={cn(
            "flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border",
            link.role === "editor"
              ? "text-amber-400 border-amber-400/30 bg-amber-400/10"
              : "text-muted-foreground border-border bg-muted"
          )}>
            {link.role === "editor" ? <PencilSimple size={9} /> : <Eye size={9} />}
            {link.role}
          </span>
          <span className="text-[10px] text-muted-foreground capitalize border border-border rounded-full px-2 py-0.5">
            {link.resource_type}
          </span>
        </div>

        {/* Expiry */}
        <p className={cn("text-[10px]", expiry.urgent ? "text-amber-400" : "text-muted-foreground")}>
          {expiry.label}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 p-3 pt-3 border-t border-border mt-auto">
        {!expired && (
          <button
            onClick={() => onCopy(link.token)}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Copy link"
          >
            {copied === link.token
              ? <><Check size={13} style={{ color: TEAL }} /> Copied</>
              : <><Copy size={13} /> Copy link</>
            }
          </button>
        )}
        <button
          onClick={() => onRevoke(link.id)}
          disabled={isPending}
          className="flex items-center justify-center p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-muted transition-colors disabled:opacity-50"
          title={expired ? "Delete" : "Revoke"}
        >
          <Trash size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Person card ───────────────────────────────────────────────
function PersonCard({
  p,
  isPending,
  onRevoke,
}: {
  p:         SharedWithUser;
  isPending: boolean;
  onRevoke:  (id: string) => void;
}) {
  const initials = p.user_name
    ? p.user_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : p.user_email[0].toUpperCase();

  return (
    <div className="group flex flex-col rounded-2xl border border-border bg-card overflow-hidden hover:border-[#2da07a]/30 hover:shadow-md transition-all">
      {/* Avatar area */}
      <div
        className="flex items-center justify-center"
        style={{ height: 80, background: `${TEAL}0d` }}
      >
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center text-base font-bold text-white"
          style={{ backgroundColor: TEAL }}
        >
          {initials}
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-1.5 p-3 flex-1">
        <p className="text-sm font-medium text-foreground truncate">
          {p.user_name ?? p.user_email}
        </p>
        {p.user_name && (
          <p className="text-xs text-muted-foreground truncate">{p.user_email}</p>
        )}

        {/* Role */}
        <span className={cn(
          "self-start flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border",
          p.role === "editor"
            ? "text-amber-400 border-amber-400/30 bg-amber-400/10"
            : "text-muted-foreground border-border bg-muted"
        )}>
          {p.role === "editor" ? <PencilSimple size={9} /> : <Eye size={9} />}
          {p.role}
        </span>

        {/* Resource */}
        <div className="flex items-center gap-1.5 mt-1">
          <ResourceIcon type={p.resource_type} mimeType={p.mime_type} size={13} />
          <p className="text-[10px] text-muted-foreground truncate">{p.resource_name}</p>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-border">
        <p className="text-[10px] text-muted-foreground">
          {new Date(p.shared_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
        </p>
        <button
          onClick={() => onRevoke(p.permission_id)}
          disabled={isPending}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-muted transition-colors disabled:opacity-50"
          title="Revoke access"
        >
          <Trash size={13} />
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function SharingPage() {
  const [tab,       setTab]       = useState<Tab>("links");
  const [links,     setLinks]     = useState<SharedLink[]>([]);
  const [people,    setPeople]    = useState<SharedWithUser[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [copied,    setCopied]    = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const load = useCallback(async () => {
    const data = await getMySharedItems();
    setLinks(data.links as SharedLink[]);
    setPeople(data.people as SharedWithUser[]);
  }, []);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  const copyLink = async (token: string) => {
    await navigator.clipboard.writeText(`${window.location.origin}/share/${token}`);
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleRevokeLink   = (id: string) => startTransition(async () => { await revokeShareLink(id);        await load(); });
  const handleRevokePerson = (id: string) => startTransition(async () => { await revokeUserPermission(id);   await load(); });

  const expiredLinks = links.filter((l) =>  l.expires_at && new Date(l.expires_at) < new Date());
  const activeLinks  = links.filter((l) => !l.expires_at || new Date(l.expires_at) >= new Date());

  const GRID = "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3";

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <ShareNetwork size={22} weight="duotone" style={{ color: TEAL }} />
          Sharing
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Manage everything you've shared — links and individual access.
        </p>
      </div>

      {/* Stats */}
      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: "Active links",        value: activeLinks.length,  icon: Globe        },
            { label: "Expired links",       value: expiredLinks.length, icon: Clock        },
            { label: "People with access",  value: people.length,       icon: Users        },
            { label: "Unique items shared", value: new Set([...links.map((l) => l.resource_id), ...people.map((p) => p.resource_id)]).size, icon: ShareNetwork },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="flex flex-col p-3 rounded-xl bg-secondary border border-border">
              <Icon size={15} weight="duotone" className="text-muted-foreground mb-2" />
              <p className="text-xl font-bold text-foreground">{value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-4 mb-5 border-b border-border">
        {([
          { key: "links",  label: "Share links", count: links.length  },
          { key: "people", label: "People",       count: people.length },
        ] as { key: Tab; label: string; count: number }[]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "pb-3 px-1 text-sm font-medium flex items-center gap-1.5 transition-colors border-b-2 -mb-px",
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

      {/* Content */}
      {loading ? (
        <div className={GRID}>
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-44 rounded-2xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {/* ── Links tab ── */}
          {tab === "links" && (
            <div className="flex flex-col gap-6">
              {links.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <LinkIcon size={40} weight="duotone" className="text-muted-foreground/40 mb-3" />
                  <p className="text-sm text-muted-foreground">No share links created yet</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Open any file or folder and use the Share option</p>
                </div>
              )}

              {activeLinks.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Active</p>
                  <div className={GRID}>
                    {activeLinks.map((link) => (
                      <LinkCard
                        key={link.id}
                        link={link}
                        copied={copied}
                        isPending={isPending}
                        onCopy={copyLink}
                        onRevoke={handleRevokeLink}
                      />
                    ))}
                  </div>
                </div>
              )}

              {expiredLinks.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Expired</p>
                  <div className={GRID}>
                    {expiredLinks.map((link) => (
                      <LinkCard
                        key={link.id}
                        link={link}
                        copied={copied}
                        isPending={isPending}
                        onCopy={copyLink}
                        onRevoke={handleRevokeLink}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── People tab ── */}
          {tab === "people" && (
            <>
              {people.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <Users size={40} weight="duotone" className="text-muted-foreground/40 mb-3" />
                  <p className="text-sm text-muted-foreground">Not sharing with anyone yet</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Share a file or folder with specific people via email</p>
                </div>
              ) : (
                <div className={GRID}>
                  {people.map((p) => (
                    <PersonCard
                      key={p.permission_id}
                      p={p}
                      isPending={isPending}
                      onRevoke={handleRevokePerson}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}