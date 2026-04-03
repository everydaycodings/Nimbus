// hooks/useDownload.ts
"use client";

import { useState } from "react";

// Cache to store preview URLs to save bandwidth and improve smoothness.
// Stores fileId -> { url, timestamp }
const previewCache = new Map<string, { url: string; timestamp: number }>();
const CACHE_TTL = 3600 * 1000; // 1 hour in milliseconds

export function useDownload() {
  const [downloading, setDownloading] = useState<Set<string>>(new Set());

  const download = async (id: string, name: string, type: "file" | "folder" | "version" = "file", downloadUrl?: string | null) => {
    if (downloading.has(id)) return;

    setDownloading((prev) => new Set(prev).add(id));

    try {
      let url = downloadUrl;

      if (!url) {
        if (type === "file") {
          // ── Single file: Get signed URL then download ──
          const res = await fetch(`/api/download?fileId=${id}&inline=false`);
          if (!res.ok) throw new Error("Failed to get download URL");

          const data = await res.json();
          url = data.url;
        } else {
          // ── Folder: Trigger streaming ZIP download (direct navigation) ──
          window.location.href = `/api/download?folderId=${id}`;
          return;
        }
      }

      if (url) {
        // We use a hidden iframe or direct location change for attachment URLs.
        // This triggers the browser's native download manager, allowing the user
        // to see progress and even close the tab while it continues.
        const iframe = document.createElement("iframe");
        iframe.style.display = "none";
        iframe.src = url;
        document.body.appendChild(iframe);
        
        // Remove the iframe after a short delay
        setTimeout(() => document.body.removeChild(iframe), 3000);
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

  const getPreviewUrl = async (fileId: string, initialUrl?: string | null): Promise<string | null> => {
    // 1. Check initialUrl first (Connect-First)
    if (initialUrl) {
      previewCache.set(fileId, { url: initialUrl, timestamp: Date.now() });
      return initialUrl;
    }

    // 2. Check cache
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