"use client";

import { useZippingStore } from "@/store/zippingStore";
import { 
  Archive, 
  CaretDown, 
  CaretUp, 
  CheckCircle, 
  CircleNotch, 
  File, 
  FileArchive, 
  FileAudio, 
  FileImage, 
  FilePdf, 
  FileText, 
  FileVideo, 
  X 
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

type Meta = {
  lastProcessed: number;
  lastTime: number;
  speed: number; // units per second (files or fragments)
};

function getFileIcon(type: "file" | "folder", mimeType?: string) {
  if (type === "folder") return <Archive size={11} weight="fill" className="text-blue-500" />;
  
  if (!mimeType) return <File size={11} weight="fill" className="text-blue-500" />;
  
  if (mimeType.startsWith("image/")) return <FileImage size={11} weight="fill" className="text-purple-500" />;
  if (mimeType.startsWith("video/")) return <FileVideo size={11} weight="fill" className="text-red-500" />;
  if (mimeType.startsWith("audio/")) return <FileAudio size={11} weight="fill" className="text-pink-500" />;
  if (mimeType === "application/pdf") return <FilePdf size={11} weight="fill" className="text-orange-500" />;
  if (mimeType.includes("zip") || mimeType.includes("tar")) return <FileArchive size={11} weight="fill" className="text-yellow-600" />;
  if (mimeType.startsWith("text/")) return <FileText size={11} weight="fill" className="text-gray-500" />;
  
  return <File size={11} weight="fill" className="text-blue-500" />;
}

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

  // 🔥 AUTO REMOVE FINISHED ITEMS
  const removalTimers = useRef<Record<string, NodeJS.Timeout>>({});

  useEffect(() => {
    zippings.forEach((z) => {
      const isFinished = z.status === "complete" || z.progress >= 100;
      if (isFinished && !removalTimers.current[z.id]) {
        removalTimers.current[z.id] = setTimeout(() => {
          removeZipping(z.id);
          delete removalTimers.current[z.id];
        }, 4000);
      }
    });

    // Cleanup: if an item is removed, clear its timer
    const currentIds = new Set(zippings.map((z) => z.id));
    Object.keys(removalTimers.current).forEach((id) => {
      if (!currentIds.has(id)) {
        clearTimeout(removalTimers.current[id]);
        delete removalTimers.current[id];
      }
    });
  }, [zippings, removeZipping]);

  if (zippings.length === 0) return null;

  // 🔥 TOTAL PROGRESS + ETA
  const totalProgress =
    zippings.reduce((acc, z) => acc + z.progress, 0) / zippings.length;

  let totalEta = "";

  const activeZippings = zippings.filter((z) => z.status === "zipping" || z.status === "preparing" || z.status === "downloading");

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

  const folderCount = zippings.filter(z => z.type === "folder").length;
  const fileCount = zippings.filter(z => z.type === "file").length;

  return (
    <div className="fixed bottom-6 right-6 w-96 z-50">
      <div className="rounded-2xl border border-border bg-background shadow-2xl p-4 flex flex-col gap-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">
            Downloading {zippings.length} item{zippings.length > 1 && "s"}
            <span className="ml-1 text-[10px] text-muted-foreground font-normal">
              ({folderCount} folder{folderCount !== 1 && "s"}, {fileCount} file{fileCount !== 1 && "s"})
            </span>
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

              if ((z.status === "zipping" || z.status === "preparing" || z.status === "downloading") && speed && speed > 0) {
                const remaining = z.totalFiles - z.filesProcessed;
                const seconds = remaining / speed;

                if (seconds > 1 && seconds < 3600) {
                  if (seconds < 60) eta = `${Math.round(seconds)}s left`;
                  else eta = `${Math.round(seconds / 60)}m left`;
                }
              }

              return (
                <div key={z.id} className="flex flex-col gap-1.5">

                  {/* Top row */}
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0 text-xs text-foreground">
                      <div className="flex items-center justify-center w-4 h-4 rounded-md bg-foreground/5">
                        {z.status === "complete" || z.progress >= 100 ? (
                           <CheckCircle size={11} weight="fill" className="text-green-500" />
                        ) : (
                           getFileIcon(z.type, z.mimeType)
                        )}
                      </div>

                      <span className="truncate">{z.name}</span>
                    </div>

                    <span className="text-[11px] text-muted-foreground w-12 text-right">
                      {z.status === "complete" || z.progress >= 100 ? "100%" : (z.type === "folder" ? `${z.filesProcessed}/${z.totalFiles}` : `${z.progress}%`)}
                    </span>

                    {(z.status === "complete" || z.status === "error" || z.progress >= 100) && (
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
                        width: `${z.status === "complete" || z.progress >= 100 ? 100 : z.progress}%`,
                        backgroundColor:
                          z.status === "error"
                            ? "#ef4444"
                            : z.status === "complete" || z.progress >= 100
                              ? "#2da07a"
                              : "#3b82f6",
                      }}
                    />
                  </div>

                  {/* Footer / Status */}
                  <div className="flex justify-between items-center text-[10px] text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      {z.status === "preparing" && z.progress < 100 && (
                        <>
                          <CircleNotch size={10} className="animate-spin" />
                          <span>Preparing...</span>
                        </>
                      )}
                      {z.status === "zipping" && z.progress < 100 && (
                        <>
                          <CircleNotch size={10} className="animate-spin text-blue-500" />
                          <span>Compressing/Downloading...</span>
                        </>
                      )}
                      {z.status === "downloading" && z.progress < 100 && (
                        <>
                          <CircleNotch size={10} className="animate-spin text-blue-500" />
                          <span>Downloading...</span>
                        </>
                      )}
                      {(z.status === "complete" || z.progress >= 100) && (
                        <span className="text-green-500">Complete!</span>
                      )}
                      {z.status === "error" && (
                        <span className="text-red-400">{z.error || "Failed"}</span>
                      )}
                    </div>
                    {eta && z.progress < 100 && (z.status === "zipping" || z.status === "preparing" || z.status === "downloading") && (
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
