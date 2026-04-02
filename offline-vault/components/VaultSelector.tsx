// offline-vault/components/VaultSelector.tsx
"use client";

import { useState } from "react";
import { Plus, LockKey, Trash, ShieldCheck, ClockAfternoon, Key, X } from "@phosphor-icons/react";
import { useOfflineVault } from "../hooks/useOfflineVault";
import { VaultEntry } from "../hooks/useVaultRegistry";
import { cn } from "@/lib/utils";

const TEAL = "#2da07a";

export default function VaultSelector() {
  const { vaults, createVault, unlockVault, deleteVault, isLoading } = useOfflineVault();
  const [isCreating, setIsCreating] = useState(false);
  const [selectedVault, setSelectedVault] = useState<VaultEntry | null>(null);
  const [password, setPassword] = useState("");
  const [newName, setNewName] = useState("");

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !password) return;
    createVault(newName, password);
    setIsCreating(false);
    setNewName("");
    setPassword("");
  };

  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedVault && password) {
      unlockVault(selectedVault, password);
      setPassword("");
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <LockKey size={22} weight="duotone" style={{ color: TEAL }} />
            Offline Vaults
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Local containers encrypted with AES-256. Data stays on your device.
          </p>
        </div>
        <button
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium text-white hover:opacity-90 transition-all"
          style={{ backgroundColor: TEAL }}
        >
          <Plus size={15} weight="bold" />
          New local vault
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {vaults.map((vault) => (
          <div
            key={vault.id}
            onClick={() => setSelectedVault(vault)}
            className="group flex flex-col p-4 rounded-2xl border border-border bg-card hover:border-[#2da07a]/30 hover:bg-[#2da07a]/5 transition-all cursor-pointer text-left relative"
          >
            <div className="flex items-center justify-between mb-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: `${TEAL}18` }}
              >
                <LockKey size={20} weight="duotone" style={{ color: TEAL }} />
              </div>
              <div className="flex items-center gap-2">
                 <span className="text-[10px] font-medium text-muted-foreground border border-border rounded-full px-2 py-0.5">
                   Offline
                 </span>
                 <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete vault "${vault.name}" and all local data?`)) deleteVault(vault.id);
                    }}
                    className="p-1.5 text-muted-foreground hover:text-red-500 rounded-lg hover:bg-red-500/10 transition-all md:opacity-0 group-hover:opacity-100"
                  >
                    <Trash size={14} />
                  </button>
              </div>
            </div>
            
            <p className="text-sm font-semibold text-foreground">{vault.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Created {new Date(vault.createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
            
            <p className="text-xs mt-3 flex items-center gap-1" style={{ color: TEAL }}>
              <LockKey size={11} />
              Click to unlock
            </p>
          </div>
        ))}

        {vaults.length === 0 && !isCreating && (
          <div className="col-span-full flex flex-col items-center justify-center py-24 text-center">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
              style={{ backgroundColor: `${TEAL}18` }}
            >
              <LockKey size={32} weight="duotone" style={{ color: TEAL }} />
            </div>
            <p className="text-sm font-semibold text-foreground mb-1">No local vaults yet</p>
            <p className="text-xs text-muted-foreground mb-6 max-w-xs">
              Create an offline vault to store files securely on this browser's local storage.
            </p>
            <button
              onClick={() => setIsCreating(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white hover:opacity-90 transition-all"
              style={{ backgroundColor: TEAL }}
            >
              <Plus size={15} weight="bold" />
              Create your first local vault
            </button>
          </div>
        )}
      </div>

      {/* Unlock / Create Modals */}
      {(selectedVault || isCreating) && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={(e) => e.target === e.currentTarget && (setIsCreating(false), setSelectedVault(null))}
        >
          <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-xl p-5 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <LockKey size={18} weight="duotone" style={{ color: TEAL }} />
                <h2 className="text-sm font-semibold text-foreground">
                  {isCreating ? "New local vault" : "Unlock vault"}
                </h2>
              </div>
              <button 
                onClick={() => { setIsCreating(false); setSelectedVault(null); }}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <X size={15} />
              </button>
            </div>

            <p className="text-xs text-muted-foreground mb-4">
              {isCreating ? "Set a name and password for your local container." : `Enter password for "${selectedVault?.name}".`}
            </p>

            <form onSubmit={isCreating ? handleCreate : handleUnlock} className="space-y-3">
              {isCreating && (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-muted-foreground px-1">Vault Name</label>
                  <input
                    autoFocus
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. My Private Safe"
                    className="w-full px-3 py-2 rounded-xl text-sm bg-secondary border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-[#2da07a]/30 focus:border-[#2da07a]/50 transition-all"
                    required
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase text-muted-foreground px-1">Passphrase</label>
                <div className="relative">
                  <Key size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    autoFocus={!isCreating}
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-9 pr-3 py-2 rounded-xl text-sm bg-secondary border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-[#2da07a]/30 focus:border-[#2da07a]/50 transition-all"
                    required
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button
                  type="button"
                  onClick={() => { setIsCreating(false); setSelectedVault(null); setPassword(""); setNewName(""); }}
                  className="px-3 py-1.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
                >
                  Cancel
                </button>
                <button
                  disabled={isLoading}
                  className="px-4 py-1.5 rounded-xl text-sm font-medium text-white hover:opacity-90 transition-all disabled:opacity-50"
                  style={{ backgroundColor: TEAL }}
                >
                  {isLoading ? "Wait..." : (isCreating ? "Create" : "Decrypt")}
                </button>
              </div>
            </form>
            
            {!isCreating && (
              <div className="mt-6 flex gap-2 text-[10px] text-orange-500 bg-orange-500/5 p-3 rounded-xl border border-orange-500/10 leading-relaxed font-medium">
                <ShieldCheck size={14} className="shrink-0" weight="fill" />
                <span>If you forget this password, the data is permanently lost.</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
