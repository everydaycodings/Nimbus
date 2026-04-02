"use client";
// offline-vault/hooks/useVaultRegistry.ts
import { useState, useCallback, useEffect } from "react";

export interface VaultEntry {
  id: string;
  name: string;
  salt: string; // Base64
  token: string; // Verification token
  createdAt: number;
}

const REGISTRY_KEY = "nimbus-vault-registry";

export function useVaultRegistry() {
  const [vaults, setVaults] = useState<VaultEntry[]>([]);

  useEffect(() => {
    const data = localStorage.getItem(REGISTRY_KEY);
    if (data) {
      try {
        setVaults(JSON.parse(data));
      } catch (e) {
        setVaults([]);
      }
    }
  }, []);

  const saveRegistry = useCallback((newVaults: VaultEntry[]) => {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(newVaults));
    setVaults(newVaults);
  }, []);

  const addVault = useCallback((entry: VaultEntry) => {
    const updated = [...vaults, entry];
    saveRegistry(updated);
  }, [vaults, saveRegistry]);

  const removeVault = useCallback((id: string) => {
    const updated = vaults.filter(v => v.id !== id);
    saveRegistry(updated);
  }, [vaults, saveRegistry]);

  return {
    vaults,
    addVault,
    removeVault,
  };
}
