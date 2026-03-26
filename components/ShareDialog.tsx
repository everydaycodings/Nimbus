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
  PencilSimple,
  Globe,
} from "@phosphor-icons/react";
import {
  shareWithUser,
  removePermission,
  updatePermissionRole,
  getSharedUsers,
  createShareLink,
  getShareLinks,
  deleteShareLink,
} from "@/actions/sharing";
import { cn } from "@/lib/utils";

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
  users:   {
    id:         string;
    email:      string;
    full_name:  string | null;
    avatar_url: string | null;
  };
}

interface ShareLink {
  id:         string;
  token:      string;
  role:       "viewer" | "editor";
  expires_at: string | null;
  created_at: string;
}

const TEAL = "#2da07a";

function normalizeSharedUsers(raw: any[]): SharedUser[] {
    return (raw ?? [])
      .map((p) => {
        const u = Array.isArray(p.users) ? p.users[0] : p.users;
        if (!u) return null;
  
        return {
          user_id: String(p.user_id),
          role: p.role as "viewer" | "editor",
          users: {
            id: String(u.id),
            email: String(u.email),
            full_name: u.full_name ?? null,
            avatar_url: u.avatar_url ?? null,
          },
        };
      })
      .filter((x): x is SharedUser => x !== null);
  }

export function ShareDialog({ resourceId, resourceName, resourceType, onClose }: Props) {
  const [tab,           setTab]           = useState<Tab>("people");
  const [email,         setEmail]         = useState("");
  const [role,          setRole]          = useState<"viewer" | "editor">("viewer");
  const [sharedUsers,   setSharedUsers]   = useState<SharedUser[]>([]);
  const [shareLinks,    setShareLinks]    = useState<ShareLink[]>([]);
  const [error,         setError]         = useState<string | null>(null);
  const [copied,        setCopied]        = useState<string | null>(null);
  const [isPending,     startTransition]  = useTransition();

  // Load existing shares on mount
  useEffect(() => {
    getSharedUsers(resourceId, resourceType).then((data) =>
        setSharedUsers(normalizeSharedUsers(data))
    );
    getShareLinks(resourceId, resourceType).then(setShareLinks);
  }, [resourceId, resourceType]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleShareWithUser = () => {
    if (!email.trim()) return;
    setError(null);

    startTransition(async () => {
      try {
        await shareWithUser(resourceId, resourceType, email.trim(), role);
        setEmail("");
        const updated = await getSharedUsers(resourceId, resourceType);
        setSharedUsers(normalizeSharedUsers(updated));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to share");
      }
    });
  };

  const handleRemoveUser = (targetUserId: string) => {
    startTransition(async () => {
      await removePermission(resourceId, resourceType, targetUserId);
      setSharedUsers((prev) => prev.filter((u) => u.user_id !== targetUserId));
    });
  };

  const handleUpdateRole = (targetUserId: string, newRole: "viewer" | "editor") => {
    startTransition(async () => {
      await updatePermissionRole(resourceId, resourceType, targetUserId, newRole);
      setSharedUsers((prev) =>
        prev.map((u) => u.user_id === targetUserId ? { ...u, role: newRole } : u)
      );
    });
  };

  const handleCreateLink = (linkRole: "viewer" | "editor") => {
    startTransition(async () => {
      try {
        const link = await createShareLink(resourceId, resourceType, linkRole, 7);
        setShareLinks((prev) => [link, ...prev]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create link");
      }
    });
  };

  const handleDeleteLink = (linkId: string) => {
    startTransition(async () => {
      await deleteShareLink(linkId);
      setShareLinks((prev) => prev.filter((l) => l.id !== linkId));
    });
  };

  const copyLink = async (token: string) => {
    const url = `${window.location.origin}/share/${token}`;
    await navigator.clipboard.writeText(url);
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
  };

  const getInitials = (name: string | null, email: string) => {
    if (name) return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
    return email[0].toUpperCase();
  };

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
              {/* Add person */}
              <div className="flex gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(null); }}
                  onKeyDown={(e) => e.key === "Enter" && handleShareWithUser()}
                  placeholder="Email address"
                  className={cn(
                    "flex-1 px-3 py-2 rounded-xl text-sm bg-secondary border text-foreground",
                    "focus:outline-none focus:ring-1 transition-all placeholder:text-muted-foreground",
                    error
                      ? "border-red-500/50 focus:ring-red-500/30"
                      : "border-border focus:ring-[#2da07a]/30 focus:border-[#2da07a]/50"
                  )}
                  disabled={isPending}
                />
                {/* Role picker */}
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as "viewer" | "editor")}
                  className="px-2 py-2 rounded-xl text-sm bg-secondary border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-[#2da07a]/30 cursor-pointer"
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                </select>
                <button
                  onClick={handleShareWithUser}
                  disabled={isPending || !email.trim()}
                  className={cn(
                    "px-3 py-2 rounded-xl text-sm font-medium text-white transition-all flex-shrink-0",
                    isPending || !email.trim()
                      ? "opacity-50 cursor-not-allowed"
                      : "hover:opacity-90"
                  )}
                  style={{ backgroundColor: TEAL }}
                >
                  <UserPlus size={16} />
                </button>
              </div>

              {error && <p className="text-xs text-red-400 -mt-2">{error}</p>}

              {/* Shared with list */}
              {sharedUsers.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Shared with {sharedUsers.length} {sharedUsers.length === 1 ? "person" : "people"}
                  </p>
                  {sharedUsers.map((su) => (
                    <div
                      key={su.user_id}
                      className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-accent transition-colors group"
                    >
                      {/* Avatar */}
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 text-white"
                        style={{ backgroundColor: TEAL }}
                      >
                        {getInitials(su.users.full_name, su.users.email)}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {su.users.full_name ?? su.users.email}
                        </p>
                        {su.users.full_name && (
                          <p className="text-xs text-muted-foreground truncate">{su.users.email}</p>
                        )}
                      </div>

                      {/* Role selector */}
                      <select
                        value={su.role}
                        onChange={(e) =>
                          handleUpdateRole(su.user_id, e.target.value as "viewer" | "editor")
                        }
                        className="text-xs bg-transparent text-muted-foreground focus:outline-none cursor-pointer hover:text-foreground transition-colors"
                      >
                        <option value="viewer">Viewer</option>
                        <option value="editor">Editor</option>
                      </select>

                      {/* Remove */}
                      <button
                        onClick={() => handleRemoveUser(su.user_id)}
                        className="p-1 rounded-lg opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all"
                      >
                        <Trash size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {sharedUsers.length === 0 && (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <UserPlus size={32} weight="duotone" className="text-muted-foreground/40 mb-2" />
                  <p className="text-xs text-muted-foreground">
                    Not shared with anyone yet
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Link tab ── */}
          {tab === "link" && (
            <div className="flex flex-col gap-4">
              {/* Create link buttons */}
              <div className="flex gap-2">
                <button
                  onClick={() => handleCreateLink("viewer")}
                  disabled={isPending}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-secondary border border-border text-secondary-foreground hover:bg-accent transition-all"
                >
                  <Eye size={15} weight="duotone" />
                  Viewer link
                </button>
                <button
                  onClick={() => handleCreateLink("editor")}
                  disabled={isPending}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-secondary border border-border text-secondary-foreground hover:bg-accent transition-all"
                >
                  <PencilSimple size={15} weight="duotone" />
                  Editor link
                </button>
              </div>

              <p className="text-xs text-muted-foreground -mt-2">
                Links expire after 7 days. Anyone with the link can access this {resourceType}.
              </p>

              {/* Existing links */}
              {shareLinks.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Active links
                  </p>
                  {shareLinks.map((link) => {
                    const url      = `${typeof window !== "undefined" ? window.location.origin : ""}/share/${link.token}`;
                    const expired  = link.expires_at && new Date(link.expires_at) < new Date();
                    const expLabel = link.expires_at
                      ? `Expires ${new Date(link.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                      : "Never expires";

                    return (
                      <div
                        key={link.id}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2.5 rounded-xl border",
                          expired ? "border-red-500/20 bg-red-500/5" : "border-border bg-secondary"
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
                            <span className="text-xs font-medium text-foreground capitalize">
                              {link.role}
                            </span>
                            <span className="text-xs text-muted-foreground">·</span>
                            <span className={cn(
                              "text-xs",
                              expired ? "text-red-400" : "text-muted-foreground"
                            )}>
                              {expired ? "Expired" : expLabel}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{url}</p>
                        </div>

                        {/* Copy */}
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

                        {/* Delete */}
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
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <LinkIcon size={32} weight="duotone" className="text-muted-foreground/40 mb-2" />
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