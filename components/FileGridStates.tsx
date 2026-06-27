"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { WarningCircle, ArrowClockwise } from "@phosphor-icons/react";

// Skeleton grid shown while a folder's contents are loading for the first time.
export function FileGridSkeleton({ count = 10 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-border bg-card overflow-hidden"
        >
          <Skeleton className="h-[100px] w-full rounded-none" />
          <div className="px-3 py-2.5 space-y-2">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-2 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Inline error state with a retry action for a failed data load.
export function FolderLoadError({
  onRetry,
  title = "Couldn't load this folder",
  description = "It may have been moved or deleted, or your connection dropped.",
}: {
  onRetry: () => void;
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 bg-red-500/10">
        <WarningCircle size={28} weight="duotone" className="text-red-400" />
      </div>
      <p className="text-sm font-medium text-foreground mb-1">{title}</p>
      <p className="text-xs text-muted-foreground mb-4">{description}</p>
      <button
        onClick={onRetry}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white transition-all hover:opacity-90"
        style={{ backgroundColor: "#2da07a" }}
      >
        <ArrowClockwise size={15} />
        Retry
      </button>
    </div>
  );
}
