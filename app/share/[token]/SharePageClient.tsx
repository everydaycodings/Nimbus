"use client";

import { useState, useEffect, useRef } from "react";
import { 
  ShieldCheck, 
  Eye, 
  Hourglass, 
  X, 
  DownloadSimple,
  Globe,
  Warning,
  Clock,
  CircleNotch
} from "@phosphor-icons/react";
import { startShareView, finishShareView } from "@/actions/sharing";
import { cn } from "@/lib/utils";
import Link from "next/link";

interface Props {
  linkId: string;
  token: string;
  ip: string;
  initialViewStatus: "pending" | "active" | "consumed";
  activatedAt: string | null;
  children: React.ReactNode; // The actual file/folder content
}

export function SharePageClient({ linkId, token, ip, initialViewStatus, activatedAt, children }: Props) {
  const [viewStatus, setViewStatus] = useState(initialViewStatus);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const GRACE_PERIOD_MS = 10 * 60 * 1000; // 10 minutes

  useEffect(() => {
    if (viewStatus === "active" && activatedAt) {
      const start = new Date(activatedAt).getTime();
      const end = start + GRACE_PERIOD_MS;
      
      const updateTimer = () => {
        const now = Date.now();
        const diff = Math.max(0, Math.floor((end - now) / 1000));
        setTimeLeft(diff);
        
        if (diff <= 0) {
          handleFinish();
        }
      };

      updateTimer();
      timerRef.current = setInterval(updateTimer, 1000);
      
      // Cleanup / Beacon
      window.addEventListener("beforeunload", handleFinish);
      return () => {
        clearInterval(timerRef.current!);
        window.removeEventListener("beforeunload", handleFinish);
      };
    }
  }, [viewStatus, activatedAt]);

  const handleReveal = async () => {
    setIsStarting(true);
    try {
      await startShareView(linkId, ip);
      window.location.reload(); // Refresh to get the 'active' server state or just set viewStatus
    } catch (err) {
      console.error(err);
    } finally {
      setIsStarting(false);
    }
  };

  const handleFinish = () => {
    // Fire and forget
    const blob = new Blob([JSON.stringify({ linkId, ip })], { type: 'application/json' });
    // Note: finishShareView is a server action, so normally we'd fetch it. 
    // But for beacons, we might need a route. Let's just use a simple fetch to an API if we had one.
    // However, since we are in a server action world, we'll try to call it normally.
    finishShareView(linkId, ip);
    setViewStatus("consumed");
  };

  if (viewStatus === "consumed") {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center animate-in fade-in zoom-in duration-300">
          <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <X size={32} className="text-red-500" />
          </div>
          <p className="text-lg font-semibold text-foreground">Link expired</p>
          <p className="text-sm text-muted-foreground mt-1">This view session has ended.</p>
          <Link href="/" className="mt-6 inline-block text-sm font-medium text-[#2da07a] hover:underline">
            Back to Nimbus
          </Link>
        </div>
      </div>
    );
  }

  if (viewStatus === "pending") {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm bg-card border border-border rounded-3xl p-8 shadow-2xl text-center space-y-6">
           <div className="w-20 h-20 bg-[#2da07a]/10 rounded-full flex items-center justify-center mx-auto">
             <ShieldCheck size={40} weight="duotone" className="text-[#2da07a]" />
           </div>
           
           <div className="space-y-2">
             <h1 className="text-xl font-bold text-foreground">Protected Resource</h1>
             <p className="text-sm text-muted-foreground">
               This is a <strong>View Once</strong> file. Once you reveal it, you will have 10 minutes to view or download it before it is permanently destroyed.
             </p>
           </div>

           <button
             onClick={handleReveal}
             disabled={isStarting}
             className="w-full flex items-center justify-center gap-2 py-4 bg-[#2da07a] text-white rounded-2xl font-semibold hover:opacity-90 transition-all disabled:opacity-50"
           >
             {isStarting ? (
               <CircleNotch size={20} className="animate-spin" />
             ) : (
               <>
                 <Eye size={20} weight="bold" />
                 Reveal Resource
               </>
             )}
           </button>
           
           <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">
             Security by Nimbus
           </p>
        </div>
      </div>
    );
  }

  // Active state
  return (
    <div className={cn(
      "relative flex flex-col h-screen bg-background transition-all duration-500",
      viewStatus === "active" && "pb-32 md:pb-0"
    )}>
      {/* Bottom Expiry Banner / Pill */}
      <div className={cn(
        "fixed z-50 transition-all duration-500 ease-out",
        "bottom-0 left-0 right-0 md:bottom-8 md:left-1/2 md:-translate-x-1/2 md:w-auto md:min-w-[400px]",
        "animate-in slide-in-from-bottom-10"
      )}>
        <div className={cn(
          "bg-card/90 backdrop-blur-xl border-t md:border border-border/50 shadow-2xl",
          "px-6 py-4 md:rounded-3xl flex flex-col md:flex-row items-center gap-4 md:gap-6"
        )}>
          {/* Status & Timer */}
          <div className="flex items-center gap-3 flex-1 w-full md:w-auto">
            <div className="w-10 h-10 rounded-full bg-[#2da07a]/10 flex items-center justify-center flex-shrink-0">
               <Hourglass size={20} weight="fill" className="text-[#2da07a] animate-pulse" />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] items-center gap-1.5 uppercase tracking-widest font-bold text-muted-foreground hidden md:flex">
                Temporary Session
              </span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground md:hidden">Expiring in</span>
                <span className={cn(
                  "text-lg font-mono font-black tabular-nums",
                  (timeLeft || 0) < 60 ? "text-red-500" : "text-[#2da07a]"
                )}>
                  {timeLeft !== null ? `${Math.floor(timeLeft / 60)}:${(timeLeft % 60).toString().padStart(2, '0')}` : "--:--"}
                </span>
                <span className="text-xs text-muted-foreground hidden md:inline">remaining</span>
              </div>
            </div>
          </div>

          <div className="h-4 w-px bg-border/50 hidden md:block" />

          {/* Action Button */}
          <button
            onClick={() => {
              if (confirm("Permanently close this view? The resource will be destroyed.")) {
                handleFinish();
              }
            }}
            className={cn(
              "w-full md:w-auto px-6 py-2.5 rounded-2xl text-sm font-bold transition-all",
              "bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white"
            )}
          >
            End & Destroy
          </button>
        </div>
      </div>

      {children}
    </div>
  );
}
