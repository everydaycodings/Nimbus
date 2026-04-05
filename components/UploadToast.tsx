"use client";

import { useUploadStore } from "@/store/uploadStore";
import { useUpload } from "@/hooks/useUpload";
import { CaretDownIcon, CaretUpIcon, LockIcon, X } from "@phosphor-icons/react";
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
  const [, forceUpdate] = useState(0);

  const [isMinimized, setIsMinimized] = useState(false);

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

  // 🔥 TOTAL PROGRESS + ETA
  const totalProgress =
    uploads.reduce((acc, f) => acc + f.progress, 0) / uploads.length;

  let totalEta = "";

  const activeUploads = uploads.filter((f) => f.progress < 100);

  if (activeUploads.length > 0) {
    let totalSeconds = 0;

    activeUploads.forEach((f) => {
      const meta = metaRef.current[f.id];
      const speed = meta?.speed || speedCache.current[f.id];

      if (speed && speed > 0) {
        const remaining = 100 - f.progress;
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
            Uploading {uploads.length} file{uploads.length > 1 && "s"}
          </p>

          <button
            onClick={() => setIsMinimized((p) => !p)}
            className="p-1.5 rounded-md hover:bg-muted transition flex items-center justify-center"
          >
            {isMinimized ? (
              <CaretUpIcon size={16} weight="bold" />
            ) : (
              <CaretDownIcon size={16} weight="bold" />
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
                  backgroundColor: "#2da07a",
                }}
              />
            </div>
          </div>
        ) : (
          /* 🔥 FULL VIEW */
          <div className="flex flex-col gap-3 max-h-80 overflow-y-auto pr-2">
            {uploads.map((f) => {
              const meta = metaRef.current[f.id];

              let eta = "";
              const currentSpeed = meta?.speed;

              // cache speed
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
                <div key={f.id} className="flex flex-col gap-1.5">

                  {/* Top row */}
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0 text-xs text-foreground">
                      {f.source === "vault" && (
                        <div className="flex items-center justify-center w-4 h-4 rounded-md bg-[#2da07a]/10">
                          <LockIcon size={11} weight="fill" className="text-[#2da07a]" />
                        </div>
                      )}

                      <span className="truncate">{f.name}</span>
                    </div>

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

                  {/* ETA */}
                  {f.status === "uploading" && eta && (
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>{eta}</span>
                    </div>
                  )}

                  {/* Status */}
                  {f.status === "error" && (
                    <div className="text-[10px] text-red-400 flex items-center gap-1">
                      <span className="truncate">
                        {f.error || "Upload failed"}
                      </span>
                    </div>
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
        )}
      </div>
    </div>
  );
}