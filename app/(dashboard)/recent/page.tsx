// app/(dashboard)/recent/page.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { Clock, Funnel } from "@phosphor-icons/react";
import { FileGrid } from "@/components/FileGrid";
import { getRecentFiles } from "@/actions/files";
import { useSearchParams } from "next/navigation";
import { FileFilters } from "@/components/FileFilters";

export default function RecentPage() {
  const [files,   setFiles]   = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const searchParams = useSearchParams();

  const type = searchParams.get("type") || "all";
  const sortBy = searchParams.get("sortBy") || "created_at";
  const sortOrder = searchParams.get("sortOrder") || "desc";
  const minSize = searchParams.get("minSize") ? Number(searchParams.get("minSize")) : undefined;
  const maxSize = searchParams.get("maxSize") ? Number(searchParams.get("maxSize")) : undefined;

  const refresh = useCallback(async () => {
    const data = await getRecentFiles();
    setFiles(data);
  }, []);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  // Client-side filtering/sorting
  const filteredFiles = files.filter((file) => {
    // Type filter
    if (type !== "all") {
      if (type === "image" && !file.mime_type.startsWith("image/")) return false;
      if (type === "video" && !file.mime_type.startsWith("video/")) return false;
      if (type === "audio" && !file.mime_type.startsWith("audio/")) return false;
      if (type === "document") {
        const docs = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"];
        if (!docs.includes(file.mime_type)) return false;
      }
    }
    // Size filter
    if (minSize !== undefined && file.size < minSize) return false;
    if (maxSize !== undefined && file.size > maxSize) return false;
    return true;
  }).sort((a, b) => {
    let comparison = 0;
    if (sortBy === "name") comparison = a.name.localeCompare(b.name);
    else if (sortBy === "size") comparison = a.size - b.size;
    else comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    
    return sortOrder === "asc" ? comparison : -comparison;
  });

  return (
    <div className="flex flex-col h-full p-6">
      <div className="flex items-center gap-2 mb-6">
        <Clock size={20} weight="duotone" className="text-muted-foreground" />
        <h1 className="text-lg font-semibold text-foreground">Recent</h1>
      </div>

      <FileFilters />

      {loading ? (
        <div className="flex flex-col gap-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-10 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : filteredFiles.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <Funnel size={48} weight="duotone" className="text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">No files match your filters</p>
        </div>
      ) : (
        <FileGrid
          files={filteredFiles}
          folders={[]}
          onRefresh={refresh}
        />
      )}
    </div>
  );
}