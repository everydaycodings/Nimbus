// components/FilePreviewDialog.tsx
"use client";

import { useEffect, useState } from "react";
import {
  X,
  DownloadSimple,
  ArrowsOut,
  File,
  FilePdf,
  FileVideo,
  MusicNote,
  Image as ImageIcon,
} from "@phosphor-icons/react";
import { useDownload } from "@/hooks/useDownload";
import { cn } from "@/lib/utils";

interface Props {
  fileId:   string;
  fileName: string;
  mimeType: string;
  onClose:  () => void;
}

function canPreview(mimeType: string) {
  return (
    mimeType.startsWith("image/") ||
    mimeType === "application/pdf" ||
    mimeType.startsWith("video/") ||
    mimeType.startsWith("audio/")
  );
}

function FileTypeIcon({ mimeType }: { mimeType: string }) {
  const cls = "text-muted-foreground/40";
  if (mimeType.startsWith("image/"))  return <ImageIcon size={64} weight="duotone" className={cls} />;
  if (mimeType === "application/pdf") return <FilePdf   size={64} weight="duotone" className="text-red-400/40" />;
  if (mimeType.startsWith("video/"))  return <FileVideo size={64} weight="duotone" className="text-blue-400/40" />;
  if (mimeType.startsWith("audio/"))  return <MusicNote size={64} weight="duotone" className="text-pink-400/40" />;
  return <File size={64} weight="duotone" className={cls} />;
}

export function FilePreviewDialog({ fileId, fileName, mimeType, onClose }: Props) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading,    setLoading]    = useState(true);
  const { download, downloading, getPreviewUrl } = useDownload();

  const isDownloading = downloading.has(fileId);
  const previewing    = canPreview(mimeType);

  useEffect(() => {
    // Close on Escape
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    if (!previewing) { setLoading(false); return; }

    getPreviewUrl(fileId).then((url) => {
      setPreviewUrl(url);
      setLoading(false);
    });
  }, [fileId, previewing]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-4 py-3 bg-card/80 border-b border-border backdrop-blur-sm">
        <p className="text-sm font-medium text-foreground truncate max-w-md">{fileName}</p>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => download(fileId, fileName)}
            disabled={isDownloading}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium text-white transition-all",
              isDownloading ? "opacity-50 cursor-not-allowed" : "hover:opacity-90"
            )}
            style={{ backgroundColor: "#2da07a" }}
          >
            <DownloadSimple size={15} weight="bold" />
            {isDownloading ? "Downloading..." : "Download"}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* ── Preview area ── */}
      <div className="flex-1 flex items-center justify-center p-6 overflow-hidden">
        {loading ? (
          <div className="w-16 h-16 rounded-2xl bg-muted animate-pulse" />
        ) : !previewing || !previewUrl ? (
          // No preview available
          <div className="flex flex-col items-center gap-4 text-center">
            <FileTypeIcon mimeType={mimeType} />
            <div>
              <p className="text-sm font-medium text-foreground">{fileName}</p>
              <p className="text-xs text-muted-foreground mt-1">No preview available</p>
            </div>
            <button
              onClick={() => download(fileId, fileName)}
              disabled={isDownloading}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white transition-all",
                isDownloading ? "opacity-50 cursor-not-allowed" : "hover:opacity-90"
              )}
              style={{ backgroundColor: "#2da07a" }}
            >
              <DownloadSimple size={16} weight="bold" />
              Download file
            </button>
          </div>
        ) : (
          <>
            {/* Image preview */}
            {mimeType.startsWith("image/") && (
              <img
                src={previewUrl}
                alt={fileName}
                className="max-w-full max-h-full object-contain rounded-xl shadow-2xl"
              />
            )}

            {/* PDF preview */}
            {mimeType === "application/pdf" && (
              <iframe
                src={previewUrl}
                className="w-full h-full rounded-xl border border-border"
                title={fileName}
              />
            )}

            {/* Video preview */}
            {mimeType.startsWith("video/") && (
              <video
                src={previewUrl}
                controls
                className="max-w-full max-h-full rounded-xl shadow-2xl"
              >
                Your browser does not support video playback.
              </video>
            )}

            {/* Audio preview */}
            {mimeType.startsWith("audio/") && (
              <div className="flex flex-col items-center gap-6">
                <MusicNote size={80} weight="duotone" className="text-pink-400/60" />
                <p className="text-sm font-medium text-foreground">{fileName}</p>
                <audio src={previewUrl} controls className="w-80">
                  Your browser does not support audio playback.
                </audio>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}