"use client";

import { useCallback } from "react";
import { useOfflineVaultStore } from "../store/offline-vault.store";
import * as crypto from "../lib/crypto";
import * as storage from "../lib/storage";
import { toast } from "sonner";
import { VaultEntry, useVaultRegistry } from "./useVaultRegistry";

export function useOfflineVault() {
  const {
    isUnlocked,
    derivedKey,
    activeVaultId,
    activeVaultName,
    files,
    isLoading,
    unlock: storeUnlock,
    lock: storeLock,
    setFiles,
    setLoading,
    setError,
  } = useOfflineVaultStore();

  const { vaults, addVault, removeVault } = useVaultRegistry();

  const createVault = useCallback(async (name: string, password: string) => {
    setLoading(true);
    try {
      const saltRaw = crypto.generateSalt();
      const key = await crypto.deriveKey(password, saltRaw);
      const token = await crypto.createVerificationToken(key);
      const id = crypto.bufferToBase64(crypto.generateSalt()).replace(/[^a-zA-Z0-9]/g, "");

      const entry: VaultEntry = {
        id,
        name,
        salt: crypto.bufferToBase64(saltRaw),
        token,
        createdAt: Date.now(),
      };

      addVault(entry);
      storeUnlock(id, name, key);
      toast.success(`Vault "${name}" created.`);
    } catch (e: any) {
      toast.error("Failed to create vault.");
    } finally {
      setLoading(false);
    }
  }, [addVault, setLoading, storeUnlock]);

  const unlockVault = useCallback(async (entry: VaultEntry, password: string) => {
    setLoading(true);
    try {
      const salt = crypto.base64ToBuffer(entry.salt);
      const key = await crypto.deriveKey(password, salt);
      const isValid = await crypto.verifyPassword(key, entry.token);

      if (!isValid) throw new Error("Invalid password.");

      storeUnlock(entry.id, entry.name, key);
      const metadata = await storage.getVaultMetadata(entry.id);
      setFiles(metadata);
      toast.success(`Unlocked "${entry.name}"`);
    } catch (e: any) {
      toast.error(e.message || "Failed to unlock vault.");
    } finally {
      setLoading(false);
    }
  }, [setLoading, storeUnlock, setFiles]);

  const refreshFiles = useCallback(async () => {
    if (!activeVaultId) return;
    const metadata = await storage.getVaultMetadata(activeVaultId);
    setFiles(metadata);
  }, [activeVaultId, setFiles]);

  const createFolder = useCallback(async (name: string, parentId: string | null = null) => {
    if (!activeVaultId) return;
    try {
      const id = crypto.bufferToBase64(crypto.generateSalt()).replace(/[^a-zA-Z0-9]/g, "");
      const meta: storage.FileMetadata = {
        id,
        vaultId: activeVaultId,
        name,
        type: "folder",
        size: 0,
        lastModified: Date.now(),
        parentId,
      };
      await storage.saveMetadata(meta);
      await refreshFiles();
      return id;
    } catch (e: any) {
      toast.error("Failed to create folder.");
    }
  }, [activeVaultId, refreshFiles]);

  const uploadFile = useCallback(async (file: File, parentId: string | null = null) => {
    if (!derivedKey || !activeVaultId) return;
    try {
      const id = crypto.bufferToBase64(crypto.generateSalt()).replace(/[^a-zA-Z0-9]/g, "");
      const buffer = await file.arrayBuffer();
      const encrypted = await crypto.encryptBuffer(buffer, derivedKey);
      
      await storage.saveFileToOpfs(activeVaultId, id, encrypted);
      const meta: storage.FileMetadata = {
        id,
        vaultId: activeVaultId,
        name: file.name,
        type: "file",
        contentType: file.type,
        size: file.size,
        lastModified: Date.now(),
        parentId,
      };
      await storage.saveMetadata(meta);
      await refreshFiles();
    } catch (e: any) {
      toast.error(`Upload failed: ${file.name}`);
    }
  }, [derivedKey, activeVaultId, refreshFiles]);

  // Recursive folder upload
  const uploadFolder = useCallback(async (fileList: FileList | File[]) => {
    if (!derivedKey || !activeVaultId) return;
    setLoading(true);
    try {
      const filesArr = Array.from(fileList);
      const folderMap = new Map<string, string>(); // path -> metadataId

      for (const file of filesArr) {
        // @ts-ignore
        const pathParts = (file.webkitRelativePath || file.name).split("/");
        let currentParentId: string | null = null;
        let runningPath = "";

        // Create folders for each path part except the last one (the file itself)
        for (let i = 0; i < pathParts.length - 1; i++) {
          runningPath += (runningPath ? "/" : "") + pathParts[i];
          if (!folderMap.has(runningPath)) {
            const folderId = await createFolder(pathParts[i], currentParentId);
            if (folderId) folderMap.set(runningPath, folderId);
          }
          currentParentId = folderMap.get(runningPath) || null;
        }

        // Upload the file into the deepest folder
        await uploadFile(file, currentParentId);
      }
      toast.success("Folder upload complete.");
    } catch (e) {
      toast.error("Folder upload failed.");
    } finally {
      setLoading(false);
    }
  }, [derivedKey, activeVaultId, createFolder, uploadFile, setLoading]);

  const downloadFile = useCallback(async (meta: storage.FileMetadata) => {
    if (!derivedKey || !activeVaultId) return;
    setLoading(true);
    try {
      const encrypted = await storage.getFileFromOpfs(activeVaultId, meta.id);
      const decrypted = await crypto.decryptBuffer(encrypted, derivedKey);
      const blob = new Blob([decrypted], { type: meta.contentType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = meta.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error("Download failed.");
    } finally {
      setLoading(false);
    }
  }, [derivedKey, activeVaultId]);

  const deleteItem = useCallback(async (item: storage.FileMetadata) => {
    if (!activeVaultId) return;
    try {
      if (item.type === "file") {
        await storage.deleteFileFromOpfs(activeVaultId, item.id);
      }
      await storage.deleteMetadata(item.id);
      await refreshFiles();
    } catch (e: any) {
      toast.error("Delete failed.");
    }
  }, [activeVaultId, refreshFiles]);

  const deleteVault = useCallback(async (vaultId: string) => {
    setLoading(true);
    try {
      await storage.deleteVaultStorage(vaultId);
      removeVault(vaultId);
      if (activeVaultId === vaultId) storeLock();
      toast.success("Vault deleted.");
    } catch (e: any) {
      toast.error("Failed to delete vault.");
    } finally {
      setLoading(false);
    }
  }, [activeVaultId, removeVault, storeLock, setLoading]);

  return {
    isUnlocked,
    activeVaultId,
    activeVaultName,
    vaults,
    files,
    isLoading,
    createVault,
    unlockVault,
    lockVault: storeLock,
    uploadFile,
    uploadFolder,
    createFolder,
    downloadFile,
    deleteItem,
    deleteVault,
    refreshFiles,
  };
}
