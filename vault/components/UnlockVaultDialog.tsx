// vault/components/UnlockVaultDialog.tsx
"use client";

import { useState, useTransition } from "react";
import { X, LockKey, Eye, EyeSlash, LockKeyOpen } from "@phosphor-icons/react";
import { deriveKey, verifyPassword, base64ToBuffer } from "@/vault/lib/crypto";
import { saveVaultSession, loadVaultSession }        from "@/vault/lib/session";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const TEAL = "#2da07a";

interface Vault {
  id:                 string;
  name:               string;
  salt:               string;
  verification_token: string;
}

interface Props {
  vault:     Vault;
  onUnlock:  (key: CryptoKey) => void;
  onClose:   () => void;
}

export function UnlockVaultDialog({ vault, onUnlock, onClose }: Props) {
  const [password,  setPassword]  = useState("");
  const [showPw,    setShowPw]    = useState(false);
  const [remember,  setRemember]  = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleUnlock = () => {
    if (!password) { toast.error("Enter the vault password"); return; }

    startTransition(async () => {
      try {
        const salt = base64ToBuffer(vault.salt);
        const key  = await deriveKey(password, salt);
        const ok   = await verifyPassword(key, vault.verification_token);

        if (!ok) {
          toast.error("Incorrect password. Try again.");
          return;
        }

        if (remember) saveVaultSession(vault.id, password);
        onUnlock(key);
      } catch {
        toast.error("Something went wrong. Try again.");
      }
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-xs bg-card border border-border rounded-2xl shadow-2xl p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <LockKey size={18} weight="duotone" style={{ color: TEAL }} />
            <div>
              <h2 className="text-sm font-semibold text-foreground">Unlock vault</h2>
              <p className="text-xs text-muted-foreground">{vault.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {/* Password input */}
          <div className="relative">
            <input
              autoFocus
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => { setPassword(e.target.value); }}
              onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
              placeholder="Vault password"
              className={cn(
                "w-full px-3 py-2 pr-10 rounded-xl text-sm bg-secondary border text-foreground focus:outline-none focus:ring-1 placeholder:text-muted-foreground transition-all",
                "border-border focus:ring-[#2da07a]/30 focus:border-[#2da07a]/50"
              )}
            />
            <button
              type="button"
              onClick={() => setShowPw(!showPw)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPw ? <EyeSlash size={15} /> : <Eye size={15} />}
            </button>
          </div>

          {/* Remember for 7 days */}
          <label className="flex items-center gap-2 cursor-pointer group">
            <div
              className={cn(
                "w-4 h-4 rounded flex items-center justify-center border transition-all flex-shrink-0",
                remember ? "border-transparent" : "border-border bg-secondary group-hover:border-[#2da07a]/40"
              )}
              style={remember ? { backgroundColor: TEAL } : {}}
              onClick={() => setRemember(!remember)}
            >
              {remember && (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M2 5l2.5 2.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
              Remember for 7 days
            </span>
          </label>

          {/* Unlock button */}
          <button
            onClick={handleUnlock}
            disabled={isPending || !password}
            className={cn(
              "w-full py-2.5 rounded-xl text-sm font-medium text-white flex items-center justify-center gap-2 transition-all",
              isPending || !password ? "opacity-40 cursor-not-allowed" : "hover:opacity-90"
            )}
            style={{ backgroundColor: TEAL }}
          >
            <LockKeyOpen size={15} weight="bold" />
            {isPending ? "Unlocking..." : "Unlock"}
          </button>
        </div>
      </div>
    </div>
  );
}