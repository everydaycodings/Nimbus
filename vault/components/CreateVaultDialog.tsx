// vault/components/CreateVaultDialog.tsx
"use client";

import { useState, useTransition } from "react";
import { X, LockKey, Eye, EyeSlash, ShieldCheck } from "@phosphor-icons/react";
import { createVault }                      from "@/vault/actions/vault.actions";
import { useCreateVaultMutation } from "@/vault/hooks/queries/useVaultMutations";
import { deriveKey, generateSalt, encryptVerificationToken, bufferToBase64, deriveStealthId, STEALTH_NAME_PREFIX } from "@/vault/lib/crypto";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Ghost, Info } from "@phosphor-icons/react";

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
  const [isStealth,   setIsStealth]   = useState(false);
  const [isFragmented, setIsFragmented] = useState(false);
  const { mutateAsync: createVaultMutation, isPending } = useCreateVaultMutation();

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

  const handleCreate = async () => {
    if (!isStealth && !name.trim()) { toast.error("Vault name is required"); return; }
    if (password.length < 8)    { toast.error("Password must be at least 8 characters"); return; }
    if (password !== confirm)   { toast.error("Passwords do not match"); return; }

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("User session not found"); return; }

      const salt              = generateSalt();
      const key               = await deriveKey(password, salt);
      const verificationToken = await encryptVerificationToken(key);
      const saltBase64        = bufferToBase64(salt);

      let vaultId: string | undefined = undefined;
      let finalName = name.trim();

      if (isStealth) {
        vaultId = await deriveStealthId(user.id, password);
        // Random suffix for "Archive_XXXXXX"
        const suffix = Math.random().toString(36).substring(2, 8).toUpperCase();
        finalName = `${STEALTH_NAME_PREFIX}${suffix}`;
      }

      await createVaultMutation({ 
        id: vaultId,
        name: finalName, 
        saltBase64, 
        verificationToken,
        isFragmented
      });
      toast.success("Vault created successfully!");
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create vault");
    }
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
          <div className={cn("transition-all", isStealth ? "opacity-30 pointer-events-none" : "opacity-100")}>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Vault name</label>
            <input
              disabled={isStealth}
              type="text"
              value={isStealth ? "Stealth Archive" : name}
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

          {/* Stealth Mode Toggle */}
          <div className="flex flex-col gap-2 p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 group transition-all">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <Ghost size={16} className={cn("transition-colors", isStealth ? "text-purple-400" : "text-muted-foreground")} />
                <span className={cn("text-xs font-medium transition-colors", isStealth ? "text-purple-400" : "text-muted-foreground")}>
                  Stealth Mode
                </span>
                <input 
                  type="checkbox" 
                  className="hidden" 
                  checked={isStealth} 
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setIsStealth(checked);
                    if (checked) setIsFragmented(true);
                  }} 
                />
                <div 
                  className={cn(
                    "w-8 h-4.5 rounded-full relative transition-all duration-300 cursor-pointer",
                    isStealth ? "bg-purple-500" : "bg-muted-foreground/30"
                  )}
                >
                  <div className={cn(
                    "absolute top-0.5 left-0.5 w-3.5 h-3.5 bg-white rounded-full transition-all duration-300 shadow-sm",
                    isStealth ? "translate-x-3.5" : "translate-x-0"
                  )} />
                </div>
              </label>
            </div>
            {isStealth && (
              <p className="text-[10px] text-purple-400/80 leading-relaxed animate-in fade-in slide-in-from-top-1">
                This vault will be invisible in your list. To access it, simply enter its password on the regular unlock screen.
              </p>
            )}
          </div>

          {/* File Fragmentation Toggle */}
          <div className="flex flex-col gap-2 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 group transition-all">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <ShieldCheck size={16} className={cn("transition-colors", isFragmented ? "text-blue-400" : "text-muted-foreground")} />
                <span className={cn("text-xs font-medium transition-colors", isFragmented ? "text-blue-400" : "text-muted-foreground")}>
                  File Fragmentation
                </span>
                <input 
                  type="checkbox" 
                  className="hidden" 
                  checked={isFragmented} 
                  onChange={(e) => setIsFragmented(e.target.checked)} 
                />
                <div 
                  className={cn(
                    "w-8 h-4.5 rounded-full relative transition-all duration-300 cursor-pointer",
                    isFragmented ? "bg-blue-500" : "bg-muted-foreground/30"
                  )}
                >
                  <div className={cn(
                    "absolute top-0.5 left-0.5 w-3.5 h-3.5 bg-white rounded-full transition-all duration-300 shadow-sm",
                    isFragmented ? "translate-x-3.5" : "translate-x-0"
                  )} />
                </div>
              </label>
            </div>
            <p className="text-[10px] text-blue-400/80 leading-relaxed">
              Splits files into multiple encrypted fragments. Higher protection against breaches, but limited to 50MB per file.
            </p>
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
            disabled={isPending || (!isStealth && !name.trim()) || password.length < 8 || password !== confirm}
            className={cn(
              "w-full py-2.5 rounded-xl text-sm font-medium text-white transition-all mt-1",
              isPending || (!isStealth && !name.trim()) || password.length < 8 || password !== confirm
                ? "opacity-40 cursor-not-allowed"
                : "hover:opacity-90"
            )}
            style={{ backgroundColor: isStealth ? "#a855f7" : TEAL }}
          >
            {isPending ? "Creating vault..." : isStealth ? "Create stealth vault" : "Create vault"}
          </button>
        </div>
      </div>
    </div>
  );
}