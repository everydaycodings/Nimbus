"use client";

import { useEffect, useRef } from "react";
import { CircleNotch } from "@phosphor-icons/react";

interface InfiniteScrollTriggerProps {
  hasMore: boolean;
  isLoading: boolean;
  onLoadMore: () => void;
}

export function InfiniteScrollTrigger({
  hasMore,
  isLoading,
  onLoadMore,
}: InfiniteScrollTriggerProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || !hasMore) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isLoading) {
          onLoadMore();
        }
      },
      { rootMargin: "360px 0px" }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, isLoading, onLoadMore]);

  if (!hasMore && !isLoading) return null;

  return (
    <div ref={ref} className="flex h-14 items-center justify-center text-xs text-muted-foreground">
      {isLoading && (
        <span className="inline-flex items-center gap-2">
          <CircleNotch size={15} className="animate-spin" />
          Loading more
        </span>
      )}
    </div>
  );
}
