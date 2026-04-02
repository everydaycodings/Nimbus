// hooks/useDownload.ts
"use client";

import { useState } from "react";

// Cache to store preview URLs to save bandwidth and improve smoothness.
// Stores fileId -> { url, timestamp }
const previewCache = new Map<string, { url: string; timestamp: number }>();
const CACHE_TTL = 3600 * 1000; // 1 hour in milliseconds

export function useDownload() {
  const [downloading, setDownloading] = useState<Set<string>>(new Set());

  const download = async (id: string, name: string, type: "file" | "folder" = "file") => {
    if (downloading.has(id)) return;

    setDownloading((prev) => new Set(prev).add(id));

    try {
      if (type === "file") {
        // ── Single file: Get signed URL then download ──
        const res = await fetch(`/api/download?fileId=${id}&inline=false`);
        if (!res.ok) throw new Error("Failed to get download URL");

        const { url } = await res.json();

        const a = document.createElement("a");
        a.href     = url;
        a.download = name;
        a.rel      = "noopener noreferrer";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        // ── Folder: Trigger streaming ZIP download (direct navigation) ──
        // Using window.location.href for streaming to disk (zero-buffering)
        window.location.href = `/api/download?folderId=${id}`;
      }
    } catch (err) {
      console.error("[download] error:", err);
    } finally {
      setDownloading((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const getPreviewUrl = async (fileId: string): Promise<string | null> => {
    // Check cache
    const cached = previewCache.get(fileId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.url;
    }

    try {
      const res = await fetch(`/api/download?fileId=${fileId}&inline=true`);
      if (!res.ok) return null;
      const { url } = await res.json();
      
      // Store in cache
      previewCache.set(fileId, { url, timestamp: Date.now() });
      
      return url;
    } catch {
      return null;
    }
  };

  return { download, getPreviewUrl, downloading };
}