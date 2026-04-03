// vault/types/vault.ts

export interface Vault {
  id: string;
  name: string;
  salt: string;
  verification_token: string;
  is_fragmented: boolean;
  created_at: string;
  updated_at: string;
}

export interface VaultFile {
  id: string;
  name: string;
  original_mime_type: string;
  size: number;
  parent_folder_id: string | null;
  vault_id: string;
  created_at: string;
  updated_at: string;
}

export type DownloadStatus = "preparing" | "zipping" | "downloading" | "complete" | "error";
