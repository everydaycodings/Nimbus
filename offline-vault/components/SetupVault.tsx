// offline-vault/components/SetupVault.tsx
"use client";

import { useState } from "react";
import { Lock, ShieldCheck, HardDrive, WarningCircle } from "@phosphor-icons/react";
import { useOfflineVault } from "../hooks/useOfflineVault";

const TEAL = "#2da07a";

export default function SetupVault() {
  const [password, setPassword] = useState("");
  const { isInitialized, initializeVault, unlockVault, isLoading } = useOfflineVault();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isInitialized) {
      unlockVault(password);
    } else {
      initializeVault(password);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-20 p-8 rounded-2xl border bg-card shadow-xl animate-in fade-in zoom-in duration-500">
      <div className="flex flex-col items-center text-center mb-8">
        <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mb-4">
          <ShieldCheck size={32} weight="fill" style={{ color: TEAL }} />
        </div>
        <h2 className="text-2xl font-bold tracking-tight">Offline Vault</h2>
        <p className="text-sm text-muted-foreground mt-2">
          {isInitialized
            ? "Enter your password to unlock your local data."
            : "Create a local-only, zero-server encrypted vault."}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Vault Password</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" size={18} />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border bg-background focus:ring-2 focus:ring-primary/20 transition-all outline-none"
              required
            />
          </div>
        </div>

        <button
          disabled={isLoading || !password}
          className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 disabled:opacity-50 transition-all shadow-lg"
          style={{ backgroundColor: TEAL }}
        >
          {isLoading ? "Processing..." : isInitialized ? "Unlock Vault" : "Initialize Local Vault"}
        </button>
      </form>

      <div className="mt-8 space-y-3">
        <div className="flex gap-3 text-xs text-muted-foreground">
          <HardDrive size={16} className="mt-0.5 shrink-0" />
          <span>Data is stored in your browser's OPFS (Local Storage) and never touches our servers.</span>
        </div>
        {!isInitialized && (
          <div className="flex gap-3 text-xs text-orange-500 bg-orange-500/10 p-3 rounded-lg border border-orange-500/20">
            <WarningCircle size={16} className="mt-0.5 shrink-0" weight="fill" />
            <span>
              If you forget this password, the data is permanently lost. There is no password recovery for offline vaults.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
