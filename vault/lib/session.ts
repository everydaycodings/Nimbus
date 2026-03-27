// vault/lib/session.ts
// Stores the vault password in localStorage for 7 days (opt-in by user).
// The KEY stored is the plaintext password — not the derived CryptoKey
// because CryptoKey objects cannot be serialised.
// Re-deriving takes ~50ms which is acceptable on unlock.

const SESSION_PREFIX = "nimbus_vault_pw_";
const TTL_MS         = 7 * 24 * 60 * 60 * 1000; // 7 days

interface StoredSession {
  password:  string;
  expiresAt: number; // unix ms
}

export function saveVaultSession(vaultId: string, password: string): void {
  const entry: StoredSession = {
    password,
    expiresAt: Date.now() + TTL_MS,
  };
  localStorage.setItem(SESSION_PREFIX + vaultId, JSON.stringify(entry));
}

export function loadVaultSession(vaultId: string): string | null {
  try {
    const raw = localStorage.getItem(SESSION_PREFIX + vaultId);
    if (!raw) return null;

    const entry: StoredSession = JSON.parse(raw);
    if (Date.now() > entry.expiresAt) {
      clearVaultSession(vaultId);
      return null;
    }

    return entry.password;
  } catch {
    return null;
  }
}

export function clearVaultSession(vaultId: string): void {
  localStorage.removeItem(SESSION_PREFIX + vaultId);
}

export function clearAllVaultSessions(): void {
  Object.keys(localStorage)
    .filter((k) => k.startsWith(SESSION_PREFIX))
    .forEach((k) => localStorage.removeItem(k));
}