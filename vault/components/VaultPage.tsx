// vault/components/VaultPage.tsx
// Main vault page — list vaults, unlock, browse files
"use client";

import { useState, useEffect, useCallback } from "react";
import {
  LockKey, LockKeyOpen, Plus, Trash, File,
  Image, FilePdf, FileVideo, MusicNote,
  CloudArrowUp, DownloadSimple, ShieldCheck,
  LockSimple,
  EyeIcon,
} from "@phosphor-icons/react";
import { getVaults, getVaultFiles, deleteVault, deleteVaultFile } from "@/vault/actions/vault.actions";
import { CreateVaultDialog }  from "@/vault/components/CreateVaultDialog";
import { UnlockVaultDialog }  from "@/vault/components/UnlockVaultDialog";
import { useVaultUpload }     from "@/vault/hooks/useVaultUpload";
import { useVaultDownload }   from "@/vault/hooks/useVaultDownload";
import { deriveKey, base64ToBuffer } from "@/vault/lib/crypto";
import { loadVaultSession, clearVaultSession } from "@/vault/lib/session";
import { canPreviewVaultFile } from "@/vault/hooks/useVaultDownload";
import { cn } from "@/lib/utils";

const TEAL = "#2da07a";

function formatBytes(bytes: number) {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function FileIcon({ mimeType, size = 18 }: { mimeType: string; size?: number }) {
  if (mimeType.startsWith("image/"))  return <Image    size={size} weight="duotone" className="text-purple-400" />;
  if (mimeType.startsWith("video/"))  return <FileVideo size={size} weight="duotone" className="text-blue-400" />;
  if (mimeType.startsWith("audio/"))  return <MusicNote size={size} weight="duotone" className="text-pink-400" />;
  if (mimeType === "application/pdf") return <FilePdf   size={size} weight="duotone" className="text-red-400" />;
  return <File size={size} weight="duotone" className="text-muted-foreground" />;
}

interface VaultFile {
  id:                 string;
  name:               string;
  original_mime_type: string;
  size:               number;
  created_at:         string;
}

interface Vault {
  id:                 string;
  name:               string;
  salt:               string;
  verification_token: string;
  created_at:         string;
}

// ── Opened vault view ─────────────────────────────────────────
function OpenVault({
  vault,
  cryptoKey,
  onLock,
  onRefreshVaults,
}: {
  vault:           Vault;
  cryptoKey:       CryptoKey;
  onLock:          () => void;
  onRefreshVaults: () => void;
}) {
  const [files,   setFiles]   = useState<VaultFile[]>([]);
  const [loading, setLoading] = useState(true);

  const { uploadMany, uploads } = useVaultUpload(vault.id, cryptoKey);
  const { download, preview, decrypting } = useVaultDownload(cryptoKey);

  const refresh = useCallback(async () => {
    const data = await getVaultFiles(vault.id);
    setFiles(data as VaultFile[]);
  }, [vault.id]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  // Refresh after uploads complete
  useEffect(() => {
    if (uploads.every((u) => u.status === "complete")) refresh();
  }, [uploads]);

  const handleDelete = async (fileId: string) => {
    await deleteVaultFile(fileId);
    refresh();
  };

  const handleDeleteVault = async () => {
    if (!confirm(`Delete vault "${vault.name}"? All encrypted files will be permanently removed.`)) return;
    clearVaultSession(vault.id);
    await deleteVault(vault.id);
    onRefreshVaults();
    onLock();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <LockKeyOpen size={18} weight="duotone" style={{ color: TEAL }} />
          <h2 className="text-base font-semibold text-foreground">{vault.name}</h2>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium text-white" style={{ backgroundColor: TEAL }}>
            Unlocked
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Upload */}
          <label className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-secondary border border-border text-secondary-foreground hover:bg-accent transition-all cursor-pointer">
            <CloudArrowUp size={15} weight="duotone" style={{ color: TEAL }} />
            Add files
            <input type="file" multiple className="hidden" onChange={(e) => e.target.files && uploadMany(e.target.files)} />
          </label>
          {/* Lock */}
          <button
            onClick={() => { clearVaultSession(vault.id); onLock(); }}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-secondary border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
          >
            <LockSimple size={15} />
            Lock
          </button>
          {/* Delete vault */}
          <button onClick={handleDeleteVault} className="p-2 rounded-xl text-muted-foreground hover:text-red-400 hover:bg-accent transition-colors">
            <Trash size={15} />
          </button>
        </div>
      </div>

      {/* Upload progress */}
      {uploads.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          {uploads.map((u) => (
            <div key={u.id} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-secondary border border-border text-sm">
              <File size={14} className="text-muted-foreground flex-shrink-0" />
              <span className="flex-1 truncate text-muted-foreground text-xs">{u.name}</span>
              {u.status === "encrypting" && <span className="text-xs text-muted-foreground">Encrypting...</span>}
              {u.status === "uploading"  && (
                <>
                  <div className="w-20 h-1 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${u.progress}%`, backgroundColor: TEAL }} />
                  </div>
                  <span className="text-xs text-muted-foreground">{u.progress}%</span>
                </>
              )}
              {u.status === "complete" && <span className="text-xs font-medium" style={{ color: TEAL }}>Done</span>}
              {u.status === "error"    && <span className="text-xs text-red-400">Failed</span>}
            </div>
          ))}
        </div>
      )}

      {/* File list */}
      {files.map((file) => {
  const previewable = canPreviewVaultFile(file.original_mime_type, file.size);

  return (
    <div key={file.id} className="group flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-accent transition-colors">
      <FileIcon mimeType={file.original_mime_type} />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
          {/* Show a "Download only" badge for large files */}
          {!previewable && (
            <span className="text-[10px] text-muted-foreground border border-border rounded-full px-1.5 py-0.5">
              Download only
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {/* Preview button — only if previewable */}
        {previewable && (
          <button
            onClick={async () => {
              const url = await preview(file.id, file.original_mime_type);
              if (url) window.open(url, "_blank");
            }}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Preview"
          >
            <EyeIcon size={14} />
          </button>
        )}

        {/* Download — always available */}
        <button
          onClick={() => download(file.id, file.name, file.original_mime_type)}
          disabled={decrypting.has(file.id)}
          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          title={decrypting.has(file.id) ? "Decrypting..." : "Decrypt & download"}
        >
          <DownloadSimple size={14} />
        </button>

        <button
          onClick={() => handleDelete(file.id)}
          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-red-400 transition-colors"
          title="Delete"
        >
          <Trash size={14} />
        </button>
      </div>
    </div>
  );
})}
    </div>
  );
}

// ── Main vault page ───────────────────────────────────────────
export function VaultPage() {
  const [vaults,          setVaults]          = useState<Vault[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [showCreate,      setShowCreate]      = useState(false);
  const [unlockTarget,    setUnlockTarget]    = useState<Vault | null>(null);
  const [openVault,       setOpenVault]       = useState<Vault | null>(null);
  const [openKey,         setOpenKey]         = useState<CryptoKey | null>(null);

  const loadVaults = useCallback(async () => {
    const data = await getVaults();
    setVaults(data as Vault[]);
  }, []);

  useEffect(() => {
    loadVaults().finally(() => setLoading(false));
  }, [loadVaults]);

  // Auto-unlock if session password is saved
  const tryAutoUnlock = async (vault: Vault) => {
    const saved = loadVaultSession(vault.id);
    if (!saved) { setUnlockTarget(vault); return; }

    try {
      const { deriveKey: dk, verifyPassword: vp, base64ToBuffer: btb } = await import("@/vault/lib/crypto");
      const salt = btb(vault.salt);
      const key  = await dk(saved, salt);
      const ok   = await vp(key, vault.verification_token);
      if (ok) {
        setOpenVault(vault);
        setOpenKey(key);
      } else {
        clearVaultSession(vault.id);
        setUnlockTarget(vault);
      }
    } catch {
      setUnlockTarget(vault);
    }
  };

  const handleUnlocked = (key: CryptoKey) => {
    setOpenVault(unlockTarget);
    setOpenKey(key);
    setUnlockTarget(null);
  };

  if (openVault && openKey) {
    return (
      <div className="p-6 h-full">
        <OpenVault
          vault={openVault}
          cryptoKey={openKey}
          onLock={() => { setOpenVault(null); setOpenKey(null); }}
          onRefreshVaults={loadVaults}
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <LockKey size={22} weight="duotone" style={{ color: TEAL }} />
            Private Vault
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Files are encrypted before upload. Only you can decrypt them.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium text-white hover:opacity-90 transition-all"
          style={{ backgroundColor: TEAL }}
        >
          <Plus size={15} weight="bold" />
          New vault
        </button>
      </div>

      {/* Vault grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <div key={i} className="h-28 rounded-2xl bg-muted animate-pulse" />)}
        </div>
      ) : vaults.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ backgroundColor: `${TEAL}18` }}>
            <LockKey size={32} weight="duotone" style={{ color: TEAL }} />
          </div>
          <p className="text-sm font-semibold text-foreground mb-1">No vaults yet</p>
          <p className="text-xs text-muted-foreground mb-6 max-w-xs">
            Create a vault to store sensitive files with end-to-end encryption.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white hover:opacity-90 transition-all"
            style={{ backgroundColor: TEAL }}
          >
            <Plus size={15} weight="bold" />
            Create your first vault
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {vaults.map((vault) => (
            <button
              key={vault.id}
              onClick={() => tryAutoUnlock(vault)}
              className="group flex flex-col p-4 rounded-2xl border border-border bg-card hover:border-[#2da07a]/30 hover:bg-[#2da07a]/5 transition-all text-left"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${TEAL}18` }}>
                  <LockKey size={20} weight="duotone" style={{ color: TEAL }} />
                </div>
                <span className="text-[10px] font-medium text-muted-foreground border border-border rounded-full px-2 py-0.5">
                  Encrypted
                </span>
              </div>
              <p className="text-sm font-semibold text-foreground">{vault.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {new Date(vault.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </p>
              <p className="text-xs mt-3 flex items-center gap-1" style={{ color: TEAL }}>
                <LockKey size={11} />
                Click to unlock
              </p>
            </button>
          ))}
        </div>
      )}

      {/* Dialogs */}
      {showCreate && (
        <CreateVaultDialog
          onSuccess={loadVaults}
          onClose={() => setShowCreate(false)}
        />
      )}
      {unlockTarget && (
        <UnlockVaultDialog
          vault={unlockTarget}
          onUnlock={handleUnlocked}
          onClose={() => setUnlockTarget(null)}
        />
      )}
    </div>
  );
}