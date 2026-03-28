// app/(dashboard)/starred/page.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { Star } from "@phosphor-icons/react";
import { FileGrid } from "@/components/FileGrid";
import { getStarredItems } from "@/actions/files";
import { useRouter } from "next/navigation";

export default function StarredPage() {
  const [files,   setFiles]   = useState<any[]>([]);
  const [folders, setFolders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const refresh = useCallback(async () => {
    const data = await getStarredItems();
    setFiles(data.files);
    setFolders(data.folders);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const isEmpty = !loading && files.length === 0 && folders.length === 0;

  return (
    <div className="flex flex-col h-full p-6">
      {/* Header */}
      <div className="flex items-center gap-2 mb-6">
        <Star size={20} weight="fill" className="text-[#2da07a]" />
        <h1 className="text-lg font-semibold text-foreground">Starred</h1>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-10 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <Star size={48} weight="duotone" className="text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">No starred items</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Star files or folders to find them quickly here
          </p>
        </div>
      ) : (
        <FileGrid
          files={files}
          folders={folders}
          onRefresh={refresh}
          onFolderOpen={(id, name) => {
            router.push(
              `/files?path=${id}&names=${encodeURIComponent(name)}`
            );
          }}
        />
      )}
    </div>
  );
}