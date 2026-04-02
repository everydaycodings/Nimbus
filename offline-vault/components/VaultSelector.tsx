// offline-vault/components/VaultSelector.tsx
"use client";

import { useState } from "react";
import { Plus, Lock, HardDrive, Trash, ShieldCheck, ClockAfternoon, Key } from "@phosphor-icons/react";
import { useOfflineVault } from "../hooks/useOfflineVault";
import { VaultEntry } from "../hooks/useVaultRegistry";

const TEAL = "#2da07a";

export default function VaultSelector() {
  const { vaults, createVault, unlockVault, deleteVault, isLoading } = useOfflineVault();
  const [isCreating, setIsCreating] = useState(false);
  const [selectedVault, setSelectedVault] = useState<VaultEntry | null>(null);
  const [password, setPassword] = useState("");
  const [newName, setNewName] = useState("");

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createVault(newName, password);
    setIsCreating(false);
    setNewName("");
    setPassword("");
  };

  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedVault) {
      unlockVault(selectedVault, password);
      setPassword("");
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-8 animate-in fade-in duration-700">
      <div className="flex items-center justify-between mb-12">
        <div>
          <h2 className="text-3xl font-black tracking-tight text-foreground/90">Locked Vaults</h2>
          <p className="text-muted-foreground text-sm mt-1">Select a local container to decrypt and access.</p>
        </div>
        <button
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-2xl font-bold text-sm shadow-xl hover:shadow-primary/20 transition-all active:scale-95"
          style={{ backgroundColor: TEAL }}
        >
          <Plus size={18} weight="bold" />
          New Vault
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {vaults.map((vault) => (
          <div
            key={vault.id}
            className="group relative bg-card/40 backdrop-blur-xl border border-border/50 rounded-[2rem] p-6 hover:border-primary/40 transition-all duration-300 shadow-2xl hover:shadow-primary/5 flex flex-col min-h-[220px] cursor-pointer"
            onClick={() => setSelectedVault(vault)}
          >
            <div className="flex justify-between items-start mb-4">
              <div className="w-12 h-12 rounded-2xl bg-secondary/50 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Lock size={24} weight="fill" style={{ color: TEAL }} />
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete vault "${vault.name}" and all local data?`)) deleteVault(vault.id);
                }}
                className="p-2 text-muted-foreground hover:text-red-500 rounded-xl hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100"
              >
                <Trash size={18} />
              </button>
            </div>

            <div className="mt-auto">
              <h3 className="text-lg font-bold truncate text-foreground/90">{vault.name}</h3>
              <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground uppercase font-bold tracking-widest">
                <span className="flex items-center gap-1">
                   <ClockAfternoon size={14} />
                   {new Date(vault.createdAt).toLocaleDateString()}
                </span>
                <span className="flex items-center gap-1">
                   <ShieldCheck size={14} />
                   AES-256
                </span>
              </div>
            </div>
            
            <div className="mt-6 flex items-center gap-2 text-primary font-bold text-xs opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0" style={{ color: TEAL }}>
              UNLOCK VAULT
            </div>
          </div>
        ))}

        {vaults.length === 0 && !isCreating && (
          <div 
            onClick={() => setIsCreating(true)}
            className="border-2 border-dashed border-border/60 rounded-[2rem] flex flex-col items-center justify-center p-12 hover:border-primary/40 transition-all cursor-pointer opacity-60 hover:opacity-100 group min-h-[220px]"
          >
            <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Plus size={32} style={{ color: TEAL }} />
            </div>
            <p className="font-bold text-sm">Create your first vault</p>
          </div>
        )}
      </div>

      {/* Unlock / Create Modals (Using fixed overlays) */}
      {(selectedVault || isCreating) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-300 overflow-y-auto">
          <div className="bg-card border w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl animate-in zoom-in-95 duration-300">
            <h3 className="text-2xl font-black mb-2">
              {isCreating ? "Initialize Vault" : "Unlock Vault"}
            </h3>
            <p className="text-sm text-muted-foreground mb-8">
              {isCreating ? "Set a name and secret key for your local safe." : `Please enter the key for "${selectedVault?.name}".`}
            </p>

            <form onSubmit={isCreating ? handleCreate : handleUnlock} className="space-y-4">
              {isCreating && (
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1">Vault Name</label>
                  <input
                    autoFocus
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. Personal Safe"
                    className="w-full px-5 py-3 rounded-2xl border bg-secondary/30 focus:ring-2 focus:ring-primary/20 outline-none transition-all font-medium"
                    required
                  />
                </div>
              )}
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1">Passphrase</label>
                <div className="relative">
                  <Key size={18} className="absolute left-4 top-1/2 -translate-y-1/2 opacity-40 text-primary" style={{ color: TEAL }} />
                  <input
                    autoFocus={!isCreating}
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-12 pr-5 py-3 rounded-2xl border bg-secondary/30 focus:ring-2 focus:ring-primary/20 outline-none transition-all font-medium"
                    required
                  />
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => { setIsCreating(false); setSelectedVault(null); setPassword(""); setNewName(""); }}
                  className="flex-1 py-3 rounded-2xl font-bold text-sm bg-secondary hover:bg-accent transition-all"
                >
                  Cancel
                </button>
                <button
                  disabled={isLoading}
                  className="flex-3 py-3 rounded-2xl font-bold text-sm text-primary-foreground hover:opacity-90 transition-all shadow-lg active:scale-95 disabled:opacity-50 px-8"
                  style={{ backgroundColor: TEAL }}
                >
                  {isLoading ? "Wait..." : (isCreating ? "Create" : "Decrypt")}
                </button>
              </div>
            </form>
            
            {!isCreating && (
              <div className="mt-8 flex gap-3 text-[10px] text-orange-500 bg-orange-500/5 p-4 rounded-3xl border border-orange-500/10 leading-relaxed font-medium">
                <ShieldCheck size={16} className="shrink-0" weight="fill" />
                <span>If you forget this password, the data inside this specific vault is permanently lost.</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
