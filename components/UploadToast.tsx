"use client";

import { useUploadStore } from "@/store/uploadStore";
import { useUpload } from "@/hooks/useUpload";
import { X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

type Meta = {
  lastProgress: number;
  lastTime: number;
  speed: number; // % per second
};

export function UploadToast() {
  const uploads = useUploadStore((s) => s.uploads);
  const { cancelUpload } = useUpload();
  const speedCache = useRef<Record<string, number>>({});

  const metaRef = useRef<Record<string, Meta>>({});
  const [, forceUpdate] = useState(0); // for re-render

  // 🔥 Calculate speed + ETA
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();

      uploads.forEach((f) => {
        const prev = metaRef.current[f.id];

        if (!prev) {
          metaRef.current[f.id] = {
            lastProgress: f.progress,
            lastTime: now,
            speed: 0,
          };
          return;
        }

        const deltaP = f.progress - prev.lastProgress;
        const deltaT = (now - prev.lastTime) / 1000;

        const speed = deltaT > 0 ? deltaP / deltaT : 0;

        metaRef.current[f.id] = {
          lastProgress: f.progress,
          lastTime: now,
          speed,
        };
      });

      forceUpdate((v) => v + 1);
    }, 500);

    return () => clearInterval(interval);
  }, [uploads]);

  if (uploads.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 w-96 z-50">
      <div className="rounded-2xl border border-border bg-background shadow-2xl p-4 flex flex-col gap-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">
            Uploading {uploads.length} file{uploads.length > 1 && "s"}
          </p>
        </div>

        {/* Files */}
        <div className="flex flex-col gap-3">
          {uploads.map((f) => {
            const meta = metaRef.current[f.id];

            let eta = "";

            const currentSpeed = meta?.speed;

            // ✅ fallback to previous speed
            if (currentSpeed && currentSpeed > 0) {
              speedCache.current[f.id] = currentSpeed;
            }

            const speed = speedCache.current[f.id];

            if (f.progress < 100 && speed && speed > 0) {
              const remaining = 100 - f.progress;
              const seconds = remaining / speed;

              if (seconds < 60) eta = `${Math.round(seconds)}s left`;
              else eta = `${Math.round(seconds / 60)}m left`;
            }

            return (
              <div
                key={f.id}
                className="flex flex-col gap-1.5"
              >
                {/* Top row */}
                <div className="flex flex-col gap-1.5">

                  {/* Top row */}
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate text-xs text-foreground">
                      {f.name}
                    </span>

                    <span className="text-[11px] text-muted-foreground w-10 text-right">
                      {f.progress}%
                    </span>

                    {f.status === "uploading" && (
                      <button
                        onClick={() => cancelUpload(f.id)}
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
                        width: `${f.progress}%`,
                        backgroundColor:
                          f.status === "error"
                            ? "#ef4444"
                            : f.status === "cancelled"
                              ? "#f59e0b"
                              : "#2da07a",
                      }}
                    />
                  </div>

                  {/* ✅ ETA (best position) */}
                  {f.status === "uploading" && eta && (
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>{eta}</span>
                      {/* optional: speed later */}
                      {/* <span>2.3 MB/s</span> */}
                    </div>
                  )}

                </div>

                {/* Status */}
                {f.status === "error" && (
                  <span className="text-[10px] text-red-400">
                    Upload failed
                  </span>
                )}

                {f.status === "cancelled" && (
                  <span className="text-[10px] text-yellow-500">
                    Cancelled
                  </span>
                )}

                {f.status === "complete" && (
                  <span className="text-[10px] text-green-500">
                    Completed
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}