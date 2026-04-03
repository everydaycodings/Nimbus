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

      if (!url) {
        if (type === "file") {
          // ── Single file: Get signed URL then download ──
          const res = await fetch(`/api/download?fileId=${id}&inline=false`);
          if (!res.ok) throw new Error("Failed to get download URL");

          const data = await res.json();
          url = data.url;
        } else {
          // ── Folder: Initialize, add to store, subscribe to progress, then download ──
          const res = await fetch("/api/download/init", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folderId: id }),
          });
          if (!res.ok) throw new Error("Failed to initialize folder download");
          const { downloadId, totalFiles, name: folderName } = await res.json();

          addZipping({
            id: downloadId,
            name: folderName,
            totalFiles,
            filesProcessed: 0,
            progress: 0,
            status: "preparing",
          });

          // Subscribe to real-time progress
          let triggered = false;
          const channel = supabase.channel(`download:${downloadId}`);
          
          channel
            .on("broadcast", { event: "progress" }, ({ payload }) => {
              const { filesProcessed, totalFiles, status: progressStatus } = payload;
              const progress = Math.round((filesProcessed / totalFiles) * 100);
              
              updateZipping(downloadId, {
                filesProcessed,
                totalFiles,
                progress: progressStatus === "started" ? 0 : progress,
                status: progressStatus === "complete" ? "complete" : "zipping"
              });
              
              if (progressStatus === "complete") {
                setTimeout(() => removeZipping(downloadId), 5000);
                void channel.unsubscribe();
              }
            })
            .subscribe((status) => {
              if (status === "SUBSCRIBED" && !triggered) {
                triggered = true;
                
                // Once subscribed, trigger the stream via hidden iframe
                const streamUrl = `/api/download?folderId=${id}&downloadId=${downloadId}`;
                const iframe = document.createElement("iframe");
                iframe.style.display = "none";
                iframe.src = streamUrl;
                document.body.appendChild(iframe);
                
                // Remove the iframe after a short delay
                setTimeout(() => {
                  if (document.body.contains(iframe)) {
                    document.body.removeChild(iframe);
                  }
                }, 5000);
              }
            });

          return;
        }
      }

      if (url) {
        // We use a hidden iframe or direct location change for attachment URLs.
        const iframe = document.createElement("iframe");
        iframe.style.display = "none";
        iframe.src = url;
        document.body.appendChild(iframe);
        
        // Remove the iframe after a short delay
        setTimeout(() => {
          if (document.body.contains(iframe)) {
            document.body.removeChild(iframe);
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