"use client";

import { CaretRight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import type { Crumb } from "@/hooks/useFolderPath";

interface Props {
  breadcrumbs: Crumb[];
  /** Label/content for the root crumb (e.g. "My Files", vault name + icon). */
  rootLabel: React.ReactNode;
  onRoot: () => void;
  onCrumb: (index: number) => void;
  className?: string;
  separator?: "slash" | "caret";
}

export function FolderBreadcrumbs({
  breadcrumbs,
  rootLabel,
  onRoot,
  onCrumb,
  className,
  separator = "slash",
}: Props) {
  const Sep = () =>
    separator === "caret" ? (
      <CaretRight size={11} className="text-muted-foreground" />
    ) : (
      <span className="text-muted-foreground">/</span>
    );

  return (
    <div
      className={cn(
        "flex items-center gap-1 text-sm overflow-x-auto scrollbar-hide whitespace-nowrap",
        className
      )}
    >
      <button
        onClick={onRoot}
        className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
      >
        {rootLabel}
      </button>

      {breadcrumbs.map((crumb, i) => (
        <span key={crumb.id} className="flex items-center gap-1">
          <Sep />
          <button
            onClick={() => onCrumb(i)}
            className={cn(
              "transition-colors",
              i === breadcrumbs.length - 1
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {crumb.name}
          </button>
        </span>
      ))}
    </div>
  );
}
