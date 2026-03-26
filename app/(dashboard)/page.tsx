// app/(dashboard)/recent/page.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { Clock } from "@phosphor-icons/react";
import { FileGrid } from "@/components/FileGrid";
import { getRecentFiles } from "@/actions/files";

export default function RecentPage() {
  const [files,   setFiles]   = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const data = await getRecentFiles();
    setFiles(data);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  return (
    <div className="flex flex-col h-full p-6">
      <div className="flex items-center gap-2 mb-6">
        <Clock size={20} weight="duotone" className="text-muted-foreground" />
        <h1 className="text-lg font-semibold text-foreground">Recent</h1>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-10 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : files.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <Clock size={48} weight="duotone" className="text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">No recent files</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Files you upload will appear here
          </p>
        </div>
      ) : (
        <FileGrid
          files={files}
          folders={[]}
          onRefresh={refresh}
        />
      )}
    </div>
  );
}