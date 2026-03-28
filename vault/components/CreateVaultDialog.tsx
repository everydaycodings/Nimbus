// vault/components/CreateVaultDialog.tsx
"use client";

import { useState, useTransition } from "react";
import { X, LockKey, Eye, EyeSlash, ShieldCheck } from "@phosphor-icons/react";
import { createVault }                      from "@/vault/actions/vault.actions";
import { deriveKey, generateSalt, encryptVerificationToken, bufferToBase64 } from "@/vault/lib/crypto";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const TEAL = "#2da07a";

interface Props {
  onSuccess: () => void;
  onClose:   () => void;
}

export function CreateVaultDialog({ onSuccess, onClose }: Props) {
  const [name,        setName]        = useState("");
  const [password,    setPassword]    = useState("");
  const [confirm,     setConfirm]     = useState("");
  const [showPw,      setShowPw]      = useState(false);
  const [isPending,   startTransition] = useTransition();

  const strength = (() => {
    if (password.length === 0)  return 0;
    if (password.length < 8)    return 1;
    if (password.length < 12)   return 2;
    const has = (re: RegExp) => re.test(password);
    const score = [/[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(has).length;
    return 2 + score;
  })();

  const strengthLabel = ["", "Weak", "Fair", "Good", "Strong", "Very strong"][strength];
  const strengthColor = ["", "#ef4444", "#f97316", "#eab308", TEAL, TEAL][strength];

  const handleCreate = () => {
    if (!name.trim())           { toast.error("Vault name is required"); return; }
    if (password.length < 8)    { toast.error("Password must be at least 8 characters"); return; }
    if (password !== confirm)   { toast.error("Passwords do not match"); return; }

    startTransition(async () => {
      try {
        const salt              = generateSalt();
        const key               = await deriveKey(password, salt);
        const verificationToken = await encryptVerificationToken(key);
        const saltBase64        = bufferToBase64(salt);

        await createVault({ name: name.trim(), saltBase64, verificationToken });
        toast.success("Vault created successfully!");
        onSuccess();
        onClose();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to create vault");
      }
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <LockKey size={18} weight="duotone" style={{ color: TEAL }} />
            <h2 className="text-sm font-semibold text-foreground">New Private Vault</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {/* Vault name */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Vault name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Personal documents"
              className="w-full px-3 py-2 rounded-xl text-sm bg-secondary border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-[#2da07a]/30 focus:border-[#2da07a]/50 placeholder:text-muted-foreground transition-all"
            />
          </div>

          {/* Password */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Encryption password</label>
            <div className="relative">
              <input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a strong password"
                className="w-full px-3 py-2 pr-10 rounded-xl text-sm bg-secondary border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-[#2da07a]/30 focus:border-[#2da07a]/50 placeholder:text-muted-foreground transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPw ? <EyeSlash size={15} /> : <Eye size={15} />}
              </button>
            </div>

            {/* Strength bar */}
            {password.length > 0 && (
              <div className="mt-2">
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <div
                      key={n}
                      className="h-1 flex-1 rounded-full transition-all duration-300"
                      style={{ backgroundColor: n <= strength ? strengthColor : "var(--muted)" }}
                    />
                  ))}
                </div>
                <p className="text-[10px] mt-1" style={{ color: strengthColor }}>{strengthLabel}</p>
              </div>
            )}
          </div>

          {/* Confirm */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Confirm password</label>
            <input
              type={showPw ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder="Re-enter password"
              className={cn(
                "w-full px-3 py-2 rounded-xl text-sm bg-secondary border text-foreground focus:outline-none focus:ring-1 placeholder:text-muted-foreground transition-all",
                confirm && confirm !== password
                  ? "border-red-500/50 focus:ring-red-500/30"
                  : "border-border focus:ring-[#2da07a]/30 focus:border-[#2da07a]/50"
              )}
            />
          </div>

          {/* Warning */}
          <div className="flex gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <ShieldCheck size={15} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-400 leading-relaxed">
              This password encrypts your vault. If you forget it, your files cannot be recovered — we never store your password.
            </p>
          </div>

          {/* Submit */}
          <button
            onClick={handleCreate}
            disabled={isPending || !name.trim() || password.length < 8 || password !== confirm}
            className={cn(
              "w-full py-2.5 rounded-xl text-sm font-medium text-white transition-all mt-1",
              isPending || !name.trim() || password.length < 8 || password !== confirm
                ? "opacity-40 cursor-not-allowed"
                : "hover:opacity-90"
            )}
            style={{ backgroundColor: TEAL }}
          >
            {isPending ? "Creating vault..." : "Create vault"}
          </button>
        </div>
      </div>
    </div>
  );
}