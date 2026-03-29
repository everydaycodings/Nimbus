// components/FileFilters.tsx
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Funnel,
  SortAscending,
  SortDescending,
  File,
  Image,
  FileVideo,
  MusicNote,
  FilePdf,
  CaretDown,
  Check,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { FileType, SortBy, SortOrder } from "@/types/filters";

const TEAL = "#2da07a";

const FILE_TYPES: { label: string; value: FileType; icon: any }[] = [
  { label: "All Files", value: "all", icon: File },
  { label: "Images", value: "image", icon: Image },
  { label: "Videos", value: "video", icon: FileVideo },
  { label: "Audio", value: "audio", icon: MusicNote },
  { label: "Documents", value: "document", icon: FilePdf },
];

const SORT_OPTIONS: { label: string; value: SortBy }[] = [
  { label: "Name", value: "name" },
  { label: "Size", value: "size" },
  { label: "Date Created", value: "created_at" },
];

export function FileFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentType = (searchParams.get("type") as FileType) || "all";
  const currentSortBy = (searchParams.get("sortBy") as SortBy) || "created_at";
  const currentSortOrder = (searchParams.get("sortOrder") as SortOrder) || "desc";

  const updateParams = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === "all" || (key === "sortOrder" && value === "desc" && currentSortBy === "created_at")) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });
    router.push(`${pathname}?${params.toString()}`);
  };

  const selectedType = FILE_TYPES.find((t) => t.value === currentType) || FILE_TYPES[0];

  return (
    <div className="flex items-center gap-3 mb-6">
      {/* Type Filter */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-border bg-card hover:bg-accent transition-all text-sm font-medium">
            <selectedType.icon size={16} weight="duotone" style={{ color: TEAL }} />
            <span>{selectedType.label}</span>
            <CaretDown size={12} className="text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48 rounded-2xl p-1.5 border-border shadow-xl">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1">
            Filter by Type
          </DropdownMenuLabel>
          {FILE_TYPES.map((type) => (
            <DropdownMenuItem
              key={type.value}
              onClick={() => updateParams({ type: type.value })}
              className="flex items-center justify-between rounded-xl px-2.5 py-2 cursor-pointer focus:bg-[#2da07a]/10"
            >
              <div className="flex items-center gap-2.5">
                <type.icon
                  size={16}
                  weight={currentType === type.value ? "fill" : "duotone"}
                  style={{ color: currentType === type.value ? TEAL : undefined }}
                />
                <span className={cn("text-sm", currentType === type.value && "font-semibold")}>
                  {type.label}
                </span>
              </div>
              {currentType === type.value && <Check size={14} weight="bold" style={{ color: TEAL }} />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Sort Options */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-border bg-card hover:bg-accent transition-all text-sm font-medium">
            {currentSortOrder === "asc" ? (
              <SortAscending size={16} weight="duotone" style={{ color: TEAL }} />
            ) : (
              <SortDescending size={16} weight="duotone" style={{ color: TEAL }} />
            )}
            <span>Sort</span>
            <CaretDown size={12} className="text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56 rounded-2xl p-1.5 border-border shadow-xl">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1">
            Sort By
          </DropdownMenuLabel>
          {SORT_OPTIONS.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onClick={() => updateParams({ sortBy: option.value })}
              className="flex items-center justify-between rounded-xl px-2.5 py-2 cursor-pointer focus:bg-[#2da07a]/10"
            >
              <span className={cn("text-sm", currentSortBy === option.value && "font-semibold")}>
                {option.label}
              </span>
              {currentSortBy === option.value && <Check size={14} weight="bold" style={{ color: TEAL }} />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator className="my-1 bg-border" />
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1">
            Order
          </DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => updateParams({ sortOrder: "asc" })}
            className="flex items-center justify-between rounded-xl px-2.5 py-2 cursor-pointer focus:bg-[#2da07a]/10"
          >
            <div className="flex items-center gap-2.5">
              <SortAscending size={16} weight="duotone" />
              <span className={cn("text-sm", currentSortOrder === "asc" && "font-semibold")}>
                Ascending
              </span>
            </div>
            {currentSortOrder === "asc" && <Check size={14} weight="bold" style={{ color: TEAL }} />}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => updateParams({ sortOrder: "desc" })}
            className="flex items-center justify-between rounded-xl px-2.5 py-2 cursor-pointer focus:bg-[#2da07a]/10"
          >
            <div className="flex items-center gap-2.5">
              <SortDescending size={16} weight="duotone" />
              <span className={cn("text-sm", currentSortOrder === "desc" && "font-semibold")}>
                Descending
              </span>
            </div>
            {currentSortOrder === "desc" && <Check size={14} weight="bold" style={{ color: TEAL }} />}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Size Filter (Optional / Simple Range) */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-border bg-card hover:bg-accent transition-all text-sm font-medium">
            <Funnel size={16} weight="duotone" style={{ color: TEAL }} />
            <span>Size</span>
            <CaretDown size={12} className="text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48 rounded-2xl p-1.5 border-border shadow-xl">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1">
            File Size
          </DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => updateParams({ minSize: null, maxSize: null })}
            className="rounded-xl px-2.5 py-2 cursor-pointer focus:bg-[#2da07a]/10 text-sm"
          >
            Any size
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => updateParams({ minSize: "0", maxSize: "1048576" })}
            className="rounded-xl px-2.5 py-2 cursor-pointer focus:bg-[#2da07a]/10 text-sm"
          >
            Small ({'<'} 1 MB)
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => updateParams({ minSize: "1048576", maxSize: "104857600" })}
            className="rounded-xl px-2.5 py-2 cursor-pointer focus:bg-[#2da07a]/10 text-sm"
          >
            Medium (1 - 100 MB)
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => updateParams({ minSize: "104857600", maxSize: null })}
            className="rounded-xl px-2.5 py-2 cursor-pointer focus:bg-[#2da07a]/10 text-sm"
          >
            Large ({'>'} 100 MB)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
