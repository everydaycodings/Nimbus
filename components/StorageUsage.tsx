"use client";

import { HardDrive } from "@phosphor-icons/react";

type Category = {
  label: string;
  size: number; // bytes
  color: string;
};

interface Props {
  total: number;
  used: number;
  categories: Category[];
  open?: boolean;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function StorageUsage({
  total,
  used,
  categories,
  open = true,
}: Props) {
  const usedPct = Math.min(100, Math.round((used / total) * 100));

  if (!open) {
    return (
      <div className="flex justify-center mt-4">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center"
          title={`${formatBytes(used)} / ${formatBytes(total)}`}
          style={{
            background: `conic-gradient(#2da07a ${usedPct * 3.6}deg, var(--muted) 0deg)`,
          }}
        >
          <div className="w-5 h-5 bg-background rounded-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 mt-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <HardDrive size={15} className="text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">
          Storage
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {formatBytes(used)} / {formatBytes(total)}
        </span>
      </div>

      {/* 🔥 Segmented Progress Bar */}
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden flex">
        {categories.map((cat) => {
          const pct = (cat.size / total) * 100;

          return (
            <div
              key={cat.label}
              style={{
                width: `${pct}%`,
                backgroundColor: cat.color,
              }}
              className="h-full transition-all"
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {categories.map((cat) => (
          <div key={cat.label} className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: cat.color }}
            />
            {cat.label}
          </div>
        ))}
      </div>

      {/* Usage text 
      <p className="mt-1 text-[11px] text-muted-foreground">
        {usedPct}% used
        {usedPct >= 90 && (
          <span className="ml-1 text-red-400 font-medium">
            — almost full
          </span>
        )}
      </p> */}
      
    </div>
  );
}