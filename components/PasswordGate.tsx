// components/PasswordGate.tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { LockSimple, Eye, EyeSlash, ArrowRight } from "@phosphor-icons/react";
import Link from "next/link";

const TEAL = "#2da07a";

const CloudSvg = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 256 256"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    className="text-white"
  >
    <path d="M160,216H72a56,56,0,0,1-4.47-111.82A72,72,0,0,1,208,120a40,40,0,0,1-48,96Z" />
  </svg>
);

interface Props {
  token: string;
}

export function PasswordGate({ token }: Props) {
  const [password,   setPassword]   = useState("");
  const [showPw,     setShowPw]     = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [shake,      setShake]      = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 500);
  };

  const handleUnlock = async () => {
    if (!password.trim() || loading) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/verify-share-password", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ token, password: password.trim() }),
      });

      const json = await res.json();
      if (json.ok) {
        // Cookie is now set — reload to let the server component render content
        window.location.reload();
      } else {
        setError(json.error === "Incorrect password" ? "Incorrect password. Try again." : (json.error ?? "Something went wrong."));
        triggerShake();
      }
    } catch {
      setError("Something went wrong. Please try again.");
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="flex items-center px-6 py-4 border-b border-border">
        <Link href="/" className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: TEAL }}
          >
            <CloudSvg />
          </div>
          <span className="text-[15px] font-bold tracking-tight text-foreground">Nimbus</span>
        </Link>
      </header>

      {/* Gate card */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div
          className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-xl p-8 flex flex-col items-center gap-6"
          style={shake ? { animation: "shake 0.4s ease" } : {}}
        >
          {/* Lock icon */}
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ background: `${TEAL}18` }}
          >
            <LockSimple size={32} weight="duotone" style={{ color: TEAL }} />
          </div>

          {/* Heading */}
          <div className="text-center">
            <h1 className="text-lg font-semibold text-foreground">Password protected</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Enter the password to access this shared content.
            </p>
          </div>

          {/* Input + button */}
          <div className="w-full flex flex-col gap-3">
            <div className="relative">
              <input
                ref={inputRef}
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null); }}
                onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
                placeholder="Enter password…"
                disabled={loading}
                className="w-full px-4 py-2.5 pr-10 rounded-xl text-sm bg-secondary border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#2da07a]/40 focus:border-[#2da07a]/60 transition-all disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showPw ? <EyeSlash size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {error && (
              <p className="text-xs text-red-400 text-center -mt-1">{error}</p>
            )}

            <button
              onClick={handleUnlock}
              disabled={!password.trim() || loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.98]"
              style={{ backgroundColor: TEAL }}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z" />
                  </svg>
                  Verifying…
                </span>
              ) : (
                <>
                  Unlock
                  <ArrowRight size={15} weight="bold" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Shake keyframe */}
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          15%       { transform: translateX(-6px); }
          30%       { transform: translateX(6px); }
          45%       { transform: translateX(-5px); }
          60%       { transform: translateX(5px); }
          75%       { transform: translateX(-3px); }
          90%       { transform: translateX(3px); }
        }
      `}</style>
    </div>
  );
}
