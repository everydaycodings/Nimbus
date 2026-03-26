// app/onboarding/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function OnboardingPage() {
  const router = useRouter();

  useEffect(() => {
    // Poll every 1.5s until the user exists in Supabase
    const interval = setInterval(async () => {
      const res = await fetch("/api/me");
      if (res.ok) {
        clearInterval(interval);
        router.replace("/");
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [router]);

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="w-8 h-8 rounded-xl bg-[#2da07a] flex items-center justify-center animate-pulse">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
            <path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
          </svg>
        </div>
        <p className="text-sm text-muted-foreground">Setting up your account...</p>
      </div>
    </div>
  );
}