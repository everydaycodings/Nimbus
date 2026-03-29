// vault/components/VaultPage.tsx
"use client";

import { useState, useCallback, useEffect } from "react";
import { LockKey, Plus } from "@phosphor-icons/react";
import { useVaultsQuery } from "@/vault/hooks/queries/useVaultQueries";
import { CreateVaultDialog } from "@/vault/components/CreateVaultDialog";
import { UnlockVaultDialog } from "@/vault/components/UnlockVaultDialog";
import { OpenVault } from "@/vault/components/OpenVault";
import { deriveKey, base64ToBuffer, verifyPassword } from "@/vault/lib/crypto";
import { loadVaultSession, clearVaultSession } from "@/vault/lib/session";

const TEAL = "#2da07a";

interface Vault {
  id: string;
  name: string;
  salt: string;
  verification_token: string;
  created_at: string;
}

export function VaultPage() {
  const { data: vaults = [], isLoading: loading, refetch: loadVaults } = useVaultsQuery();
  const [showCreate, setShowCreate] = useState(false);
  const [unlockTarget, setUnlockTarget] = useState<Vault | null>(null);
  const [openVault, setOpenVault] = useState<Vault | null>(null);
  const [openKey, setOpenKey] = useState<CryptoKey | null>(null);

  const tryAutoUnlock = async (vault: Vault) => {
    const saved = loadVaultSession(vault.id);
    if (!saved) {
      setUnlockTarget(vault);
      return;
    }

    try {
      const salt = base64ToBuffer(vault.salt);
      const key = await deriveKey(saved, salt);
      const ok = await verifyPassword(key, vault.verification_token);
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
          onLock={() => {
            setOpenVault(null);
            setOpenKey(null);
          }}
          onRefreshVaults={loadVaults}
        />
      </div>
    );
  }

  return (
    <div className="p-6">
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

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-28 rounded-2xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : vaults.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ backgroundColor: `${TEAL}18` }}
          >
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
              className="group flex flex-col p-4 rounded-2xl border border-border bg-card hover:border-[#2da07a]/30 hover:bg-[#2da07a]/5 transition-all cursor-pointer text-left"
            >
              <div className="flex items-center justify-between mb-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: `${TEAL}18` }}
                >
                  <LockKey size={20} weight="duotone" style={{ color: TEAL }} />
                </div>
                <span className="text-[10px] font-medium text-muted-foreground border border-border rounded-full px-2 py-0.5">
                  Encrypted
                </span>
              </div>
              <p className="text-sm font-semibold text-foreground">{vault.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {new Date(vault.created_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
              <p className="text-xs mt-3 flex items-center gap-1" style={{ color: TEAL }}>
                <LockKey size={11} />
                Click to unlock
              </p>
            </button>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateVaultDialog onSuccess={loadVaults} onClose={() => setShowCreate(false)} />
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
