// offline-vault/lib/storage.ts
/**
 * Offline Vault Storage Layer
 * Uses OPFS (Origin Private File System) for binary blobs and IndexedDB for metadata.
 */

export interface FileMetadata {
  id: string;
  vaultId: string; // Associated vault ID
  name: string;
  type: "file" | "folder";
  contentType?: string; // Optional for folders
  size: number;
  lastModified: number;
  parentId: string | null;
}

const DB_NAME = "nimbus-offline-vault-v2";
const STORE_NAME = "metadata";
const DB_VERSION = 1;

// ── IndexedDB Metadata Management ───────────────────────────
async function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("vaultId", "vaultId", { unique: false });
        store.createIndex("parentId", "parentId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveMetadata(meta: FileMetadata): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(meta);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getVaultMetadata(vaultId: string): Promise<FileMetadata[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const index = tx.objectStore(STORE_NAME).index("vaultId");
    const request = index.getAll(IDBKeyRange.only(vaultId));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteMetadata(id: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── OPFS Blob Management ──────────────────────────────────────
export async function getOpfsDirectory(vaultId: string): Promise<FileSystemDirectoryHandle> {
  if (!navigator.storage || !navigator.storage.getDirectory) {
    throw new Error("OPFS is not supported in this browser.");
  }
  const root = await navigator.storage.getDirectory();
  return await root.getDirectoryHandle(vaultId, { create: true });
}

export async function saveFileToOpfs(vaultId: string, id: string, data: Uint8Array): Promise<void> {
  const vaultDir = await getOpfsDirectory(vaultId);
  const fileHandle = await vaultDir.getFileHandle(id, { create: true });
  // @ts-ignore
  const writable = await fileHandle.createWritable();
  await writable.write(data.buffer as ArrayBuffer);
  await writable.close();
}

export async function getFileFromOpfs(vaultId: string, id: string): Promise<Uint8Array> {
  const vaultDir = await getOpfsDirectory(vaultId);
  const fileHandle = await vaultDir.getFileHandle(id);
  const file = await fileHandle.getFile();
  const buffer = await file.arrayBuffer();
  return new Uint8Array(buffer);
}

export async function deleteFileFromOpfs(vaultId: string, id: string): Promise<void> {
  const vaultDir = await getOpfsDirectory(vaultId);
  await vaultDir.removeEntry(id);
}

// ── Vault Lifecycle ───────────────────────────────────────────
export async function deleteVaultStorage(vaultId: string): Promise<void> {
  // Clear OPFS vault directory
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(vaultId, { recursive: true });
  } catch (e) {
    console.error("Failed to delete vault subdirectory", e);
  }

  // Clear Metadata for this vault
  const db = await getDB();
  const metadata = await getVaultMetadata(vaultId);
  await Promise.all(metadata.map(m => deleteMetadata(m.id)));
}
