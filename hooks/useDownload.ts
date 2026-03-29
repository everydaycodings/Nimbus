// hooks/useDownload.ts
"use client";

import { useState } from "react";

// Cache to store preview URLs to save bandwidth and improve smoothness.
// Stores fileId -> { url, timestamp }
const previewCache = new Map<string, { url: string; timestamp: number }>();
const CACHE_TTL = 3600 * 1000; // 1 hour in milliseconds

export function useDownload() {
  const [downloading, setDownloading] = useState<Set<string>>(new Set());

  const download = async (fileId: string, fileName: string) => {
    if (downloading.has(fileId)) return;

    setDownloading((prev) => new Set(prev).add(fileId));

    try {
      const res = await fetch(`/api/download?fileId=${fileId}&inline=false`);
      if (!res.ok) throw new Error("Failed to get download URL");

      const { url } = await res.json();

      // Trigger browser download without navigating away
      const a = document.createElement("a");
      a.href     = url;
      a.download = fileName;
      a.rel      = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error("[download] error:", err);
    } finally {
      setDownloading((prev) => {
        const next = new Set(prev);
        next.delete(fileId);
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