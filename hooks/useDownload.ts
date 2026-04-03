// hooks/useDownload.ts
"use client";

import { useState } from "react";

// Cache to store preview URLs to save bandwidth and improve smoothness.
// Stores fileId -> { url, timestamp }
const previewCache = new Map<string, { url: string; timestamp: number }>();
const CACHE_TTL = 3600 * 1000; // 1 hour in milliseconds

export function useDownload() {
  const [downloading, setDownloading] = useState<Set<string>>(new Set());

  const download = async (id: string, name: string, type: "file" | "folder" = "file", initialUrl?: string | null) => {
    if (downloading.has(id)) return;

    setDownloading((prev) => new Set(prev).add(id));

    try {
      let url = initialUrl;

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
        // If we have a URL (especially a pre-signed S3 one), fetching as a blob
        // is the only reliable way to force a download across origins.
        const res = await fetch(url);
        if (!res.ok) throw new Error("Download fetch failed");
        
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        // Clean up the object URL to free memory
        setTimeout(() => URL.revokeObjectURL(blobUrl), 100);
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