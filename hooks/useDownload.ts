// hooks/useDownload.ts
"use client";

import { useState, useCallback, useMemo } from "react";
import { useZippingStore } from "@/store/zippingStore";
import { createClient } from "@/lib/supabase/client";

// Cache to store preview URLs to save bandwidth and improve smoothness.
// Stores fileId -> { url, timestamp }
const previewCache = new Map<string, { url: string; timestamp: number }>();
const CACHE_TTL = 3600 * 1000; // 1 hour in milliseconds

export function useDownload() {
  const { addZipping, updateZipping, removeZipping } = useZippingStore();
  const supabase = useMemo(() => createClient(), []);
  const [downloading, setDownloading] = useState<Set<string>>(new Set());

  const download = useCallback(async (id: string, name: string, type: "file" | "folder" | "version" = "file", downloadUrl?: string | null) => {
    if (downloading.has(id)) return;

    setDownloading((prev) => new Set(prev).add(id));

    try {
      let url = downloadUrl;
      const downloadId = type === "file" ? `file-${id}-${Math.random().toString(36).substring(7)}` : id;

      if (!url) {
        if (type === "file" || type === "version") {
          // ── Single file: Add to store, get signed URL then download ──
          addZipping({
            id: downloadId,
            name: name,
            totalFiles: 1,
            filesProcessed: 0,
            progress: 0,
            status: "preparing",
            type: "file",
          });

          const res = await fetch(`/api/download?fileId=${id}&inline=false`);
          if (!res.ok) {
            updateZipping(downloadId, { status: "error", error: "Failed to get download URL" });
            throw new Error("Failed to get download URL");
          }

          const data = await res.json();
          url = data.url;

          updateZipping(downloadId, { status: "downloading", progress: 50 });
        } else {
          // ── Folder: Initialize, add to store, subscribe to progress, then download ──
          const res = await fetch("/api/download/init", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folderId: id }),
          });
          if (!res.ok) throw new Error("Failed to initialize folder download");
          const { downloadId: serverDownloadId, totalFiles, name: folderName } = await res.json();

          addZipping({
            id: serverDownloadId,
            name: folderName,
            totalFiles,
            filesProcessed: 0,
            progress: 0,
            status: "preparing",
            type: "folder",
          });

          // Subscribe to real-time progress
          let triggered = false;
          const channel = supabase.channel(`download:${serverDownloadId}`);
          
          channel
            .on("broadcast", { event: "progress" }, ({ payload }) => {
              const { filesProcessed, totalFiles, status: progressStatus } = payload;
              const progress = Math.round((filesProcessed / totalFiles) * 100);
              
              updateZipping(serverDownloadId, {
                filesProcessed,
                totalFiles,
                progress: progressStatus === "started" ? 0 : progress,
                status: progressStatus === "complete" ? "complete" : "zipping"
              });
              
              if (progressStatus === "complete") {
                setTimeout(() => removeZipping(serverDownloadId), 5000);
                void channel.unsubscribe();
              }
            })
            .subscribe((status) => {
              if (status === "SUBSCRIBED" && !triggered) {
                triggered = true;
                
                // Once subscribed, trigger the stream via native anchor link
                const streamUrl = `/api/download?folderId=${id}&downloadId=${serverDownloadId}`;
                const a = document.createElement("a");
                a.style.display = "none";
                a.href = streamUrl;
                a.download = folderName + ".zip";
                document.body.appendChild(a);
                a.click();
                
                // Remove the anchor after a short delay
                setTimeout(() => {
                  if (document.body.contains(a)) {
                    document.body.removeChild(a);
                  }
                }, 5000);
              }
            });

          return;
        }
      }

      if (url) {
        // We use an anchor tag for file downloads.
        const a = document.createElement("a");
        a.style.display = "none";
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        
        if (type === "file" || type === "version") {
          updateZipping(downloadId, { status: "complete", progress: 100 });
          setTimeout(() => removeZipping(downloadId), 5000);
        }

        // Remove the anchor after a short delay
        setTimeout(() => {
          if (document.body.contains(a)) {
            document.body.removeChild(a);
          }
        }, 3000);
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
  }, [addZipping, updateZipping, removeZipping, supabase, downloading]);

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