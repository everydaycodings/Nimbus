// components/SearchBar.tsx
"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MagnifyingGlass,
  File,
  FolderSimple,
  Image,
  FilePdf,
  VideoIcon,
  MusicNote,
  Spinner,
  X,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

interface SearchResult {
  id:         string;
  name:       string;
  type:       "file" | "folder";
  mime_type?: string;
  size?:      number;
  created_at: string;
}

function FileIcon({ mimeType }: { mimeType?: string }) {
  if (!mimeType) return <FolderSimple size={16} weight="fill" className="text-[#2da07a]" />;
  if (mimeType.startsWith("image/"))  return <Image     size={16} weight="duotone" className="text-purple-400" />;
  if (mimeType.startsWith("video/"))  return <VideoIcon  size={16} weight="duotone" className="text-blue-400" />;
  if (mimeType.startsWith("audio/"))  return <MusicNote  size={16} weight="duotone" className="text-pink-400" />;
  if (mimeType === "application/pdf") return <FilePdf    size={16} weight="duotone" className="text-red-400" />;
  return <File size={16} weight="duotone" className="text-muted-foreground" />;
}

export function SearchBar() {
  const [query,    setQuery]    = useState("");
  const [results,  setResults]  = useState<SearchResult[]>([]);
  const [open,     setOpen]     = useState(false);
  const [loading,  setLoading]  = useState(false);
  const inputRef               = useRef<HTMLInputElement>(null);
  const containerRef           = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router                 = useRouter();

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();

        const combined: SearchResult[] = [
          ...(data.folders ?? []).map((f: any) => ({ ...f, type: "folder" as const })),
          ...(data.files   ?? []).map((f: any) => ({ ...f, type: "file"   as const })),
        ];

        setResults(combined);
        setOpen(combined.length > 0);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
      };
  }, [query]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const handleSelect = (result: SearchResult) => {
    setOpen(false);
    setQuery("");
    if (result.type === "folder") {
      router.push(`/files?folder=${result.id}`);
    }
    // For files, you could open preview — for now just navigate to files
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <div ref={containerRef} className="relative w-full max-w-sm">
      {/* Input */}
      <div className="relative">
        <MagnifyingGlass
          size={15}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
        />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search files..."
          className={cn(
            "w-full h-9 pl-9 pr-16 rounded-xl text-sm",
            "bg-secondary border border-border text-foreground",
            "placeholder:text-muted-foreground",
            "focus:outline-none focus:ring-1 focus:ring-[#2da07a]/30 focus:border-[#2da07a]/50",
            "transition-all duration-150"
          )}
        />
        {/* Right side: spinner or clear + shortcut hint */}
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
          {loading && (
            <Spinner size={13} className="text-muted-foreground animate-spin" />
          )}
          {query && !loading && (
            <button
              onClick={() => { setQuery(""); setResults([]); setOpen(false); }}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X size={13} />
            </button>
          )}
          {!query && (
            <kbd className="hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-muted border border-border text-[10px] text-muted-foreground font-mono">
              ⌘K
            </kbd>
          )}
        </div>
      </div>

      {/* Dropdown results */}
      {open && results.length > 0 && (
        <div className="absolute top-11 left-0 right-0 z-50 bg-popover border border-border rounded-xl shadow-lg overflow-hidden">
          {/* Folders first */}
          {results.filter((r) => r.type === "folder").length > 0 && (
            <div>
              <p className="px-3 pt-2 pb-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                Folders
              </p>
              {results
                .filter((r) => r.type === "folder")
                .map((result) => (
                  <button
                    key={result.id}
                    onClick={() => handleSelect(result)}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-accent transition-colors text-left"
                  >
                    <FileIcon />
                    <span className="flex-1 text-sm text-foreground truncate">{result.name}</span>
                    <span className="text-xs text-muted-foreground flex-shrink-0">
                      {formatDate(result.created_at)}
                    </span>
                  </button>
                ))}
            </div>
          )}

          {/* Files */}
          {results.filter((r) => r.type === "file").length > 0 && (
            <div>
              <p className="px-3 pt-2 pb-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                Files
              </p>
              {results
                .filter((r) => r.type === "file")
                .map((result) => (
                  <button
                    key={result.id}
                    onClick={() => handleSelect(result)}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-accent transition-colors text-left"
                  >
                    <FileIcon mimeType={result.mime_type} />
                    <span className="flex-1 text-sm text-foreground truncate">{result.name}</span>
                    <span className="text-xs text-muted-foreground flex-shrink-0">
                      {formatDate(result.created_at)}
                    </span>
                  </button>
                ))}
            </div>
          )}

          {/* No more results hint */}
          <div className="px-3 py-2 border-t border-border">
            <p className="text-[10px] text-muted-foreground">
              {results.length} result{results.length !== 1 ? "s" : ""} for "{query}"
            </p>
          </div>
        </div>
      )}

      {/* Empty state */}
      {open && results.length === 0 && !loading && query.length >= 2 && (
        <div className="absolute top-11 left-0 right-0 z-50 bg-popover border border-border rounded-xl shadow-lg p-4 text-center">
          <p className="text-sm text-muted-foreground">No results for "{query}"</p>
        </div>
      )}
    </div>
  );
}