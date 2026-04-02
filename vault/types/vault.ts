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
