// offline-vault/store/offline-vault.store.ts
import { create } from "zustand";
import { FileMetadata } from "../lib/storage";

interface OfflineVaultState {
  isUnlocked: boolean;
  derivedKey: CryptoKey | null;
  activeVaultId: string | null;
  activeVaultName: string | null;
  files: FileMetadata[];
  isLoading: boolean;
  error: string | null;

  // Actions
  unlock: (vaultId: string, name: string, key: CryptoKey) => void;
  lock: () => void;
  setFiles: (files: FileMetadata[]) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useOfflineVaultStore = create<OfflineVaultState>((set) => ({
  isUnlocked: false,
  derivedKey: null,
  activeVaultId: null,
  activeVaultName: null,
  files: [],
  isLoading: false,
  error: null,

  unlock: (vaultId, name, key) => set({ 
    isUnlocked: true, 
    activeVaultId: vaultId,
    activeVaultName: name,
    derivedKey: key, 
    error: null 
  }),
  lock: () => set({ 
    isUnlocked: false, 
    activeVaultId: null,
    activeVaultName: null,
    derivedKey: null, 
    files: [], 
    error: null 
  }),
  setFiles: (files) => set({ files }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}));
