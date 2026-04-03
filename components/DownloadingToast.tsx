"use client";

import { useZippingStore } from "@/store/zippingStore";
import { Archive, CaretDown, CaretUp, CheckCircle, CircleNotch, DownloadSimple, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

type Meta = {
  lastProcessed: number;
  lastTime: number;
  speed: number; // files per second
};

export function DownloadingToast() {
  const zippings = useZippingStore((s) => s.zippings);
  const removeZipping = useZippingStore((s) => s.removeZipping);

  const speedCache = useRef<Record<string, number>>({});
  const metaRef = useRef<Record<string, Meta>>({});
  const [, forceUpdate] = useState(0);

  const [isMinimized, setIsMinimized] = useState(false);

  // 🔥 Calculate speed + ETA
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();

      zippings.forEach((z) => {
        const prev = metaRef.current[z.id];

        if (!prev) {
          metaRef.current[z.id] = {
            lastProcessed: z.filesProcessed,
            lastTime: now,
            speed: 0,
          };
          return;
        }

        const deltaF = z.filesProcessed - prev.lastProcessed;
        const deltaT = (now - prev.lastTime) / 1000;

        const speed = deltaT > 0 ? deltaF / deltaT : 0;

        metaRef.current[z.id] = {
          lastProcessed: z.filesProcessed,
          lastTime: now,
          speed,
        };
      });

      forceUpdate((v) => v + 1);
    }, 500);

    return () => clearInterval(interval);
  }, [zippings]);

  if (zippings.length === 0) return null;

  // 🔥 TOTAL PROGRESS + ETA
  const totalProgress =
    zippings.reduce((acc, z) => acc + z.progress, 0) / zippings.length;

  let totalEta = "";

  const activeZippings = zippings.filter((z) => z.status === "zipping" || z.status === "preparing");

  if (activeZippings.length > 0) {
    let totalSeconds = 0;

    activeZippings.forEach((z) => {
      const meta = metaRef.current[z.id];
      const speed = meta?.speed || speedCache.current[z.id];

      if (speed && speed > 0) {
        const remaining = z.totalFiles - z.filesProcessed;
        totalSeconds += remaining / speed;
      }
    });

    if (totalSeconds > 0) {
      if (totalSeconds < 60) totalEta = `${Math.round(totalSeconds)}s left`;
      else totalEta = `${Math.round(totalSeconds / 60)}m left`;
    }
  }

  return (
    <div className="fixed bottom-6 right-6 w-96 z-50">
      <div className="rounded-2xl border border-border bg-background shadow-2xl p-4 flex flex-col gap-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">
            Downloading {zippings.length} folder{zippings.length > 1 && "s"}
          </p>

          <button
            onClick={() => setIsMinimized((p) => !p)}
            className="p-1.5 rounded-md hover:bg-muted transition flex items-center justify-center"
          >
            {isMinimized ? (
              <CaretUp size={16} weight="bold" />
            ) : (
              <CaretDown size={16} weight="bold" />
            )}
          </button>
        </div>

        {/* 🔥 MINIMIZED VIEW */}
        {isMinimized ? (
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{Math.round(totalProgress)}%</span>
              <span>{totalEta}</span>
            </div>

            <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
              <div
                className="h-full transition-all duration-300"
                style={{
                  width: `${totalProgress}%`,
                  backgroundColor: "#3b82f6",
                }}
              />
            </div>
          </div>
        ) : (
          /* 🔥 FULL VIEW */
          <div className="flex flex-col gap-3 max-h-64 overflow-y-auto pr-1">
            {zippings.map((z) => {
              const meta = metaRef.current[z.id];

              let eta = "";
              const currentSpeed = meta?.speed;

              // cache speed
              if (currentSpeed && currentSpeed > 0) {
                speedCache.current[z.id] = currentSpeed;
              }

              const speed = speedCache.current[z.id];

              if ((z.status === "zipping" || z.status === "preparing") && speed && speed > 0) {
                const remaining = z.totalFiles - z.filesProcessed;
                const seconds = remaining / speed;

                if (seconds < 60) eta = `${Math.round(seconds)}s left`;
                else eta = `${Math.round(seconds / 60)}m left`;
              }

              return (
                <div key={z.id} className="flex flex-col gap-1.5">

                  {/* Top row */}
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0 text-xs text-foreground">
                      <div className="flex items-center justify-center w-4 h-4 rounded-md bg-blue-500/10">
                        {z.status === "complete" ? (
                           <CheckCircle size={11} weight="fill" className="text-green-500" />
                        ) : (
                           <Archive size={11} weight="fill" className="text-blue-500" />
                        )}
                      </div>

                      <span className="truncate">{z.name}</span>
                    </div>

                    <span className="text-[11px] text-muted-foreground w-12 text-right">
                      {z.status === "complete" ? "100%" : `${z.filesProcessed}/${z.totalFiles}`}
                    </span>

                    {(z.status === "complete" || z.status === "error") && (
                      <button
                        onClick={() => removeZipping(z.id)}
                        className="p-1 rounded-md hover:bg-muted transition"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full transition-all duration-300"
                      style={{
                        width: `${z.status === "complete" ? 100 : z.progress}%`,
                        backgroundColor:
                          z.status === "error"
                            ? "#ef4444"
                            : z.status === "complete"
                              ? "#2da07a"
                              : "#3b82f6",
                      }}
                    />
                  </div>

                  {/* Footer / Status */}
                  <div className="flex justify-between items-center text-[10px] text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      {z.status === "preparing" && (
                        <>
                          <CircleNotch size={10} className="animate-spin" />
                          <span>Preparing files...</span>
                        </>
                      )}
                      {z.status === "zipping" && (
                        <>
                          <CircleNotch size={10} className="animate-spin text-blue-500" />
                          <span>Downloading folder...</span>
                        </>
                      )}
                      {z.status === "complete" && (
                        <span className="text-green-500">Download complete!</span>
                      )}
                      {z.status === "error" && (
                        <span className="text-red-400">{z.error || "Download failed"}</span>
                      )}
                    </div>
                    {eta && (z.status === "zipping" || z.status === "preparing") && (
                      <span>{eta}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
