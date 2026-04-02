// components/ShareDialog.tsx
"use client";

import { useState, useEffect, useTransition } from "react";
import {
  X,
  UserPlus,
  Link as LinkIcon,
  Copy,
  Check,
  Trash,
  Eye,
  EyeSlash,
  Globe,
  Clock,
  LockSimple,
  ShieldCheck,
  Warning,
  DownloadSimple,
} from "@phosphor-icons/react";
import {
  shareWithUser,
  removePermission,
  getSharedUsers,
  createShareLink,
  getShareLinks,
  deleteShareLink,
} from "@/actions/sharing";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

interface Props {
  resourceId:   string;
  resourceName: string;
  resourceType: "file" | "folder";
  onClose:      () => void;
}

type Tab = "people" | "link";

interface SharedUser {
  user_id: string;
  role:    "viewer" | "editor";
  users: {
    id:         string;
    email:      string;
    name:  string | null;
    avatar_url: string | null;
  };
}

interface ShareLink {
  id:                   string;
  token:                string;
  role:                 "viewer" | "editor";
  expires_at:           string | null;
  created_at:           string;
  is_password_protected: boolean;
  max_views:             number | null;
  view_count:            number;
  self_destruct_target:  "link" | "resource";
  can_download:          boolean;
}

const TEAL = "#2da07a";

// ── Expiry options ────────────────────────────────────────────
const EXPIRY_OPTIONS: { label: string; minutes: number | null }[] = [
  { label: "5 minutes",  minutes: 5           },
  { label: "1 hour",     minutes: 60          },
  { label: "24 hours",   minutes: 60 * 24     },
  { label: "3 days",     minutes: 60 * 24 * 3 },
  { label: "1 week",     minutes: 60 * 24 * 7 },
  { label: "1 month",    minutes: 60 * 24 * 30},
  { label: "Never",      minutes: null        },
];

function getExpiryLabel(expiresAt: string | null): string {
  if (!expiresAt) return "Never expires";
  const exp  = new Date(expiresAt);
  const now  = new Date();
  const diff = exp.getTime() - now.getTime();
  if (diff <= 0) return "Expired";

  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);

  if (mins  < 60)  return `Expires in ${mins}m`;
  if (hours < 24)  return `Expires in ${hours}h`;
  if (days  < 30)  return `Expires in ${days}d`;
  return `Expires ${exp.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

function normalizeSharedUsers(raw: any[]): SharedUser[] {
  return (raw ?? [])
    .map((p) => {
      const u = Array.isArray(p.users) ? p.users[0] : p.users;
      if (!u) return null;
      return {
        user_id: String(p.user_id),
        role:    p.role as "viewer" | "editor",
        users: {
          id:         String(u.id),
          email:      String(u.email),
          name:  u.name  ?? null,
          avatar_url: u.avatar_url ?? null,
        },
      };
    })
    .filter((x): x is SharedUser => x !== null);
}

export function ShareDialog({ resourceId, resourceName, resourceType, onClose }: Props) {
  const [tab,              setTab]              = useState<Tab>("people");
  const [email,            setEmail]            = useState("");
  const [role]                  = useState<"viewer" | "editor">("viewer");
  const [linkRole]              = useState<"viewer" | "editor">("viewer");
  const [expiryMins,       setExpiryMins]       = useState<number | null>(60 * 24 * 7); // default 1 week
  const [passwordProtect,  setPasswordProtect]  = useState(false);
  const [linkPassword,     setLinkPassword]     = useState("");
  const [showLinkPassword, setShowLinkPassword] = useState(false);
  const [selfDestruct,     setSelfDestruct]     = useState(false);
  const [maxViews,         setMaxViews]         = useState<number>(1);
  const [sdTarget,         setSdTarget]         = useState<"link" | "resource">("link");
  const [canDownload,      setCanDownload]      = useState(false);
  const [sharedUsers,      setSharedUsers]      = useState<SharedUser[]>([]);
  const [shareLinks,       setShareLinks]       = useState<ShareLink[]>([]);
  const [copied,           setCopied]           = useState<string | null>(null);
  const [isPending,        startTransition]     = useTransition();

  const queryClient = useQueryClient();

  useEffect(() => {
    getSharedUsers(resourceId, resourceType).then((data) =>
      setSharedUsers(normalizeSharedUsers(data))
    );
    getShareLinks(resourceId, resourceType).then(setShareLinks);
  }, [resourceId, resourceType]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleShareWithUser = () => {
    if (!email.trim()) return;
    startTransition(async () => {
      try {
        await shareWithUser(resourceId, resourceType, email.trim(), role);
        toast.success(`Shared with ${email.trim()}`);
        setEmail("");
        const updated = await getSharedUsers(resourceId, resourceType);
        setSharedUsers(normalizeSharedUsers(updated));
        queryClient.invalidateQueries({ queryKey: queryKeys.sharing() });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to share");
      }
    });
  };

  const handleRemoveUser = (targetUserId: string) => {
    startTransition(async () => {
      try {
        await removePermission(resourceId, resourceType, targetUserId);
        toast.success("User removed from share list");
        setSharedUsers((prev) => prev.filter((u) => u.user_id !== targetUserId));
        queryClient.invalidateQueries({ queryKey: queryKeys.sharing() });
      } catch(err) {
        toast.error("Failed to remove user");
      }
    });
  };



  const handleCreateLink = () => {
    startTransition(async () => {
      try {
        // Convert minutes to days for the action (null = never)
        const expiresInDays = expiryMins === null
          ? undefined
          : expiryMins / (60 * 24);

        const password = passwordProtect && linkPassword.trim() ? linkPassword.trim() : undefined;

        const link = await createShareLink(
          resourceId,
          resourceType,
          linkRole,
          expiresInDays,
          password,
          selfDestruct ? maxViews : undefined,
          sdTarget,
          canDownload
        );
        setShareLinks((prev) => [link, ...prev]);
        // Reset password fields after creation
        setPasswordProtect(false);
        setLinkPassword("");
        queryClient.invalidateQueries({ queryKey: queryKeys.sharing() });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to create link");
      }
    });
  };

  const handleDeleteLink = (linkId: string) => {
    startTransition(async () => {
      await deleteShareLink(linkId);
      setShareLinks((prev) => prev.filter((l) => l.id !== linkId));
      queryClient.invalidateQueries({ queryKey: queryKeys.sharing() });
    });
  };

  const copyLink = async (token: string) => {
    const url = `${window.location.origin}/share/${token}`;
    await navigator.clipboard.writeText(url);
    toast.success("Link copied to clipboard!");
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
  };

  const getInitials = (name: string | null, email: string) => {
    if (name) return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
    return email[0].toUpperCase();
  };

  const selectedExpiry = EXPIRY_OPTIONS.find((o) => o.minutes === expiryMins) ?? EXPIRY_OPTIONS[6];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-xl flex flex-col max-h-[600px]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Share</h2>
            <p className="text-xs text-muted-foreground truncate max-w-[300px]">{resourceName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex px-5 gap-4 border-b border-border">
          {(["people", "link"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "pb-3 text-sm font-medium capitalize transition-colors border-b-2 -mb-px",
                tab === t
                  ? "border-[#2da07a] text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {t === "people" ? "People" : "Link"}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* ── People tab ── */}
          {tab === "people" && (
            <div className="flex flex-col gap-4">
              <div className="flex gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); }}
                  onKeyDown={(e) => e.key === "Enter" && handleShareWithUser()}
                  placeholder="Email address"
                  className={cn(
                    "flex-1 px-3 py-2 rounded-xl text-sm bg-secondary border text-foreground",
                    "focus:outline-none focus:ring-1 transition-all placeholder:text-muted-foreground",
                    "border-border focus:ring-[#2da07a]/30 focus:border-[#2da07a]/50"
                  )}
                  disabled={isPending}
                />

                <button
                  onClick={handleShareWithUser}
                  disabled={isPending || !email.trim()}
                  className={cn(
                    "px-3 py-2 rounded-xl text-sm font-medium text-white transition-all flex-shrink-0",
                    isPending || !email.trim() ? "opacity-50 cursor-not-allowed" : "hover:opacity-90"
                  )}
                  style={{ backgroundColor: TEAL }}
                >
                  <UserPlus size={16} />
                </button>
              </div>

              {sharedUsers.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Shared with {sharedUsers.length} {sharedUsers.length === 1 ? "person" : "people"}
                  </p>
                  {sharedUsers.map((su) => (
                    <div
                      key={su.user_id}
                      className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-accent transition-colors group"
                    >
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 text-white"
                        style={{ backgroundColor: TEAL }}
                      >
                        {getInitials(su.users.name, su.users.email)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {su.users.name ?? su.users.email}
                        </p>
                        {su.users.name && (
                          <p className="text-xs text-muted-foreground truncate">{su.users.email}</p>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground mr-2">Viewer</span>
                      <button
                        onClick={() => handleRemoveUser(su.user_id)}
                        className="p-1 rounded-lg opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all"
                      >
                        <Trash size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <UserPlus size={32} weight="duotone" className="text-muted-foreground/40 mb-2" />
                  <p className="text-xs text-muted-foreground">Not shared with anyone yet</p>
                </div>
              )}
            </div>
          )}

          {/* ── Link tab ── */}
          {tab === "link" && (
            <div className="flex flex-col gap-4">

              {/* ── Link config card ── */}
              <div className="rounded-xl border border-border bg-secondary p-4 flex flex-col gap-3">


                {/* Expiry picker */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock size={15} weight="duotone" className="text-muted-foreground" />
                    <span className="text-sm text-foreground font-medium">Expires</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 justify-end">
                    {EXPIRY_OPTIONS.map((opt) => (
                      <button
                        key={opt.label}
                        onClick={() => setExpiryMins(opt.minutes)}
                        className={cn(
                          "px-2.5 py-1 rounded-lg text-xs font-medium transition-all border",
                          expiryMins === opt.minutes
                            ? "text-white border-transparent"
                            : "text-muted-foreground border-border hover:text-foreground hover:border-foreground/20 bg-transparent"
                        )}
                        style={expiryMins === opt.minutes ? { backgroundColor: TEAL, borderColor: TEAL } : {}}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Password protect row */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <LockSimple size={15} weight="duotone" className="text-muted-foreground" />
                      <span className="text-sm text-foreground font-medium">Password protect</span>
                    </div>
                    {/* Toggle switch */}
                    <button
                      role="switch"
                      aria-checked={passwordProtect}
                      onClick={() => { setPasswordProtect((v) => !v); setLinkPassword(""); }}
                      className={cn(
                        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none",
                        passwordProtect ? "" : "bg-border"
                      )}
                      style={passwordProtect ? { backgroundColor: TEAL } : {}}
                    >
                      <span
                        className={cn(
                          "inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
                          passwordProtect ? "translate-x-4.5" : "translate-x-0.5"
                        )}
                      />
                    </button>
                  </div>

                  {passwordProtect && (
                    <div className="relative">
                      <input
                        type={showLinkPassword ? "text" : "password"}
                        value={linkPassword}
                        onChange={(e) => setLinkPassword(e.target.value)}
                        placeholder="Set a password…"
                        className={cn(
                          "w-full px-3 py-2 pr-9 rounded-xl text-sm bg-background border text-foreground",
                          "focus:outline-none focus:ring-1 transition-all placeholder:text-muted-foreground",
                          "border-border focus:ring-[#2da07a]/30 focus:border-[#2da07a]/50"
                        )}
                      />
                      <button
                        type="button"
                        onClick={() => setShowLinkPassword((v) => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        tabIndex={-1}
                      >
                        {showLinkPassword ? <EyeSlash size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  )}
                </div>

                {/* Self-destruct row */}
                <div className="flex flex-col gap-3 pt-1 border-t border-border/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShieldCheck size={15} weight="duotone" className="text-muted-foreground" />
                      <span className="text-sm text-foreground font-medium">Self-destruct</span>
                    </div>
                    <button
                      role="switch"
                      aria-checked={selfDestruct}
                      onClick={() => setSelfDestruct(!selfDestruct)}
                      className={cn(
                        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none",
                        selfDestruct ? "" : "bg-border"
                      )}
                      style={selfDestruct ? { backgroundColor: TEAL } : {}}
                    >
                      <span
                        className={cn(
                          "inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
                          selfDestruct ? "translate-x-4.5" : "translate-x-0.5"
                        )}
                      />
                    </button>
                  </div>

                  {selfDestruct && (
                    <div className="flex flex-col gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
                      {/* Max Views */}
                      <div className="flex items-center justify-between bg-background/50 rounded-xl px-3 py-2 border border-border">
                        <span className="text-xs text-muted-foreground">Expire after</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            max={999}
                            value={maxViews}
                            onChange={(e) => setMaxViews(Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-12 bg-transparent text-right text-xs font-semibold focus:outline-none"
                          />
                          <span className="text-xs text-muted-foreground">{maxViews === 1 ? "view" : "views"}</span>
                        </div>
                      </div>

                      {/* SD Target */}
                      <div className="flex flex-col gap-2">
                        <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground px-1">Behavior</p>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => setSdTarget("link")}
                            className={cn(
                              "flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition-all text-center",
                              sdTarget === "link"
                                ? "bg-background border-[#2da07a]/40 shadow-sm"
                                : "bg-transparent border-border hover:bg-background/50"
                            )}
                          >
                            <Globe size={16} weight={sdTarget === "link" ? "fill" : "duotone"} style={{ color: sdTarget === "link" ? TEAL : undefined }} />
                            <span className={cn("text-[11px] font-medium", sdTarget === "link" ? "text-foreground" : "text-muted-foreground")}>Delete link</span>
                          </button>
                          <button
                            onClick={() => setSdTarget("resource")}
                            className={cn(
                              "flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition-all text-center group",
                              sdTarget === "resource"
                                ? "bg-red-500/5 border-red-500/40 shadow-sm"
                                : "bg-transparent border-border hover:bg-red-500/5 hover:border-red-500/20"
                            )}
                          >
                            <Warning size={16} weight={sdTarget === "resource" ? "fill" : "duotone"} className={cn(sdTarget === "resource" ? "text-red-500" : "text-muted-foreground group-hover:text-red-500/60")} />
                            <span className={cn("text-[11px] font-medium", sdTarget === "resource" ? "text-red-600" : "text-muted-foreground group-hover:text-red-500/60")}>Delete original</span>
                          </button>
                        </div>
                        {sdTarget === "resource" && (
                          <p className="text-[10px] text-red-500/80 px-1 leading-relaxed">
                            ⚠️ Warning: The actual {resourceType} will be permanently deleted after {maxViews} {maxViews === 1 ? "view" : "views"}.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Allow Download row */}
                <div className="flex flex-col gap-2 pt-1 border-t border-border/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <DownloadSimple size={15} weight="duotone" className="text-muted-foreground" />
                      <span className="text-sm text-foreground font-medium">Allow download</span>
                    </div>
                    {/* Toggle switch */}
                    <button
                      role="switch"
                      aria-checked={canDownload}
                      onClick={() => setCanDownload(!canDownload)}
                      className={cn(
                        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none",
                        canDownload ? "" : "bg-border"
                      )}
                      style={canDownload ? { backgroundColor: TEAL } : {}}
                    >
                      <span
                        className={cn(
                          "inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
                          canDownload ? "translate-x-4.5" : "translate-x-0.5"
                        )}
                      />
                    </button>
                  </div>
                </div>
              </div>

              {/* Create button */}
              <button
                onClick={handleCreateLink}
                disabled={isPending || (passwordProtect && !linkPassword.trim())}
                className={cn(
                  "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-all",
                  isPending || (passwordProtect && !linkPassword.trim()) ? "opacity-50 cursor-not-allowed" : "hover:opacity-90"
                )}
                style={{ backgroundColor: (selfDestruct && sdTarget === "resource") ? "#ef4444" : TEAL }}
              >
                {selfDestruct && sdTarget === "resource" ? <Warning size={15} weight="bold" /> : <LinkIcon size={15} />}
                {isPending
                  ? "Creating…"
                  : selfDestruct && sdTarget === "resource"
                    ? `Create Destructive Link · ${selectedExpiry.label} · ${maxViews} views`
                    : `Create link · ${selectedExpiry.label}${selfDestruct ? ` · ${maxViews} ${maxViews === 1 ? 'view' : 'views'}` : ""}${passwordProtect && linkPassword.trim() ? " · 🔒" : ""}`
                }
              </button>

              {/* Existing links */}
              {shareLinks.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-medium text-muted-foreground">Active links</p>
                  {shareLinks.map((link) => {
                    const url     = `${typeof window !== "undefined" ? window.location.origin : ""}/share/${link.token}`;
                    const expired = link.expires_at && new Date(link.expires_at) < new Date();

                    return (
                      <div
                        key={link.id}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors",
                          expired ? "border-red-500/20 bg-red-500/5" :
                          link.self_destruct_target === "resource" ? "border-red-500/30 bg-red-500/5" : "border-border bg-secondary"
                        )}
                      >
                        <Globe
                          size={16}
                          weight="duotone"
                          style={{ color: expired ? "#ef4444" : TEAL }}
                          className="flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            {link.is_password_protected && (
                              <span
                                className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                                style={{ backgroundColor: `${TEAL}18`, color: TEAL }}
                                title="Password protected"
                              >
                                <LockSimple size={9} weight="bold" />
                                Protected
                              </span>
                            )}
                            {link.can_download && (
                              <span
                                className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                                style={{ backgroundColor: `${TEAL}18`, color: TEAL }}
                                title="Download enabled"
                              >
                                <DownloadSimple size={9} weight="bold" />
                                Downloadable
                              </span>
                            )}
                            <span className="text-xs text-muted-foreground">·</span>
                            <span className={cn("text-xs", expired ? "text-red-400" : "text-muted-foreground")}>
                              {expired ? "Expired" : getExpiryLabel(link.expires_at)}
                            </span>
                            {link.max_views && (
                              <>
                                <span className="text-xs text-muted-foreground">·</span>
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-tight transition-all",
                                    link.view_count >= (link.max_views ?? 0)
                                      ? "bg-red-500 text-white shadow-sm"
                                      : "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 shadow-[0_0_8px_-2px_rgba(239,68,68,0.2)]"
                                  )}
                                  title="Self-destruct link: link will be deleted after limited views"
                                >
                                  {link.view_count}/{link.max_views} views
                                </span>
                              </>
                            )}
                            {link.self_destruct_target === "resource" && (
                              <>
                                <span className="text-xs text-muted-foreground">·</span>
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-600 text-white font-black uppercase tracking-widest shadow-sm ring-2 ring-red-500/20 animate-pulse">
                                  Destructive
                                </span>
                              </>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{url}</p>
                        </div>

                        {!expired && (
                          <button
                            onClick={() => copyLink(link.token)}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
                            title="Copy link"
                          >
                            {copied === link.token
                              ? <Check size={14} style={{ color: TEAL }} />
                              : <Copy size={14} />
                            }
                          </button>
                        )}

                        <button
                          onClick={() => handleDeleteLink(link.id)}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-accent transition-colors flex-shrink-0"
                          title="Delete link"
                        >
                          <Trash size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {shareLinks.length === 0 && (
                <div className="flex flex-col items-center justify-center py-4 text-center">
                  <LinkIcon size={28} weight="duotone" className="text-muted-foreground/40 mb-2" />
                  <p className="text-xs text-muted-foreground">No links created yet</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}