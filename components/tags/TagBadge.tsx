// components/tags/TagBadge.tsx
"use client";

import { cn } from "@/lib/utils";
import { Tag } from "@/types/tags";

interface TagBadgeProps {
  tag: Tag;
  className?: string;
  onRemove?: () => void;
  size?: "sm" | "md";
}

export function TagBadge({ tag, className, onRemove, size = "sm" }: TagBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-medium transition-all select-none",
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
        className
      )}
      style={{
        backgroundColor: `${tag.color}20`, // 12% opacity background
        color: tag.color,
        border: `1px solid ${tag.color}40`, // 25% opacity border
      }}
    >
      {tag.name}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-1 hover:opacity-70 transition-opacity"
        >
          ×
        </button>
      )}
    </span>
  );
}
