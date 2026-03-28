"use client";

import { Rows, SquaresFour } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import type { Layout } from "@/hooks/useLayout";

export function LayoutToggle({ layout, onChange }: { layout: Layout; onChange: (l: Layout) => void }) {
  return (
    <div className="flex items-center gap-0.5 bg-secondary border border-border rounded-lg p-0.5">
      <button
        onClick={() => onChange("list")}
        className={cn("p-1.5 rounded-md transition-all", layout === "list" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
        title="List view"
      >
        <Rows size={15} />
      </button>
      <button
        onClick={() => onChange("grid")}
        className={cn("p-1.5 rounded-md transition-all", layout === "grid" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}
        title="Grid view"
      >
        <SquaresFour size={15} />
      </button>
    </div>
  );
}
