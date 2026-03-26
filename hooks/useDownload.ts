// hooks/useDownload.ts
"use client";

import { useState } from "react";

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
    try {
      const res = await fetch(`/api/download?fileId=${fileId}&inline=true`);
      if (!res.ok) return null;
      const { url } = await res.json();
      return url;
    } catch {
      return null;
    }
  };

  return { download, getPreviewUrl, downloading };
}