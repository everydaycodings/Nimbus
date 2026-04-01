// components/SearchBar.tsx
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  MagnifyingGlass,
  File,
  FolderSimple,
  Image,
  FilePdf,
  FileVideo,
  MusicNote,
  Spinner,
  X,
  ClockCounterClockwise,
} from "@phosphor-icons/react";
import { FilePreviewDialog } from "@/components/FilePreviewDialog";
import { cn } from "@/lib/utils";

interface SearchResult {
  id:         string;
  name:       string;
  type:       "file" | "folder";
  mime_type?: string;
  size?:      number;
  created_at: string;
}

function FileIcon({ mimeType, size = 16 }: { mimeType?: string; size?: number }) {
  if (!mimeType)                      return <FolderSimple size={size} weight="fill"   className="text-[#2da07a]" />;
  if (mimeType.startsWith("image/"))  return <Image        size={size} weight="duotone" className="text-purple-400" />;
  if (mimeType.startsWith("video/"))  return <FileVideo    size={size} weight="duotone" className="text-blue-400" />;
  if (mimeType.startsWith("audio/"))  return <MusicNote    size={size} weight="duotone" className="text-pink-400" />;
  if (mimeType === "application/pdf") return <FilePdf      size={size} weight="duotone" className="text-red-400" />;
  return <File size={size} weight="duotone" className="text-muted-foreground" />;
}

function formatDate(iso: string) {
  const d    = new Date(iso);
  const now  = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7)   return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const RECENT_KEY    = "nimbus_recent_searches";
const RECENT_MAX    = 5;

function loadRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); } catch { return []; }
}

function saveRecent(query: string) {
  const prev    = loadRecent().filter((q) => q !== query);
  const updated = [query, ...prev].slice(0, RECENT_MAX);
  localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
}

function removeRecent(query: string) {
  const updated = loadRecent().filter((q) => q !== query);
  localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
}

export function SearchBar() {
  const [query,          setQuery]          = useState("");
  const [results,        setResults]        = useState<SearchResult[]>([]);
  const [open,           setOpen]           = useState(false);
  const [loading,        setLoading]        = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [activeIndex,    setActiveIndex]    = useState(-1);

  // File preview state — clicking a file opens the preview dialog
  const [previewFile, setPreviewFile] = useState<{
    id: string; name: string; mimeType: string;
  } | null>(null);

  const inputRef     = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router       = useRouter();

  // Load recent searches on mount
  useEffect(() => {
    setRecentSearches(loadRecent());
  }, []);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setActiveIndex(-1);

    if (query.length < 2) {
      setResults([]);
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
      } finally {
        setLoading(false);
      }
    }, 280);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
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

  // Global Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Keyboard navigation inside dropdown
  const allItems = results.length > 0 ? results : [];

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { setOpen(false); inputRef.current?.blur(); return; }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, allItems.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    }
    if (e.key === "Enter" && activeIndex >= 0) {
      handleSelect(allItems[activeIndex]);
    }
  };

  const handleSelect = useCallback((result: SearchResult) => {
    saveRecent(result.name);
    setRecentSearches(loadRecent());
    setOpen(false);
    setQuery("");
    setResults([]);

    if (result.type === "folder") {
      // Navigate to files page and open this folder
      router.push(`/dashboard/files?folder=${result.id}&name=${encodeURIComponent(result.name)}`);
    } else {
      // Open file preview dialog directly from search
      setPreviewFile({ id: result.id, name: result.name, mimeType: result.mime_type ?? "" });
    }
  }, [router]);

  const handleRecentClick = (term: string) => {
    setQuery(term);
    inputRef.current?.focus();
  };

  const showDropdown = open && (
    (query.length >= 2) ||
    (query.length === 0 && recentSearches.length > 0)
  );

  const showRecents  = query.length < 2 && recentSearches.length > 0;
  const showResults  = query.length >= 2;
  const hasResults   = results.length > 0;

  const folders = results.filter((r) => r.type === "folder");
  const files   = results.filter((r) => r.type === "file");

  // Running index for keyboard nav
  let navIndex = 0;

  return (
    <>
      <div ref={containerRef} className="relative flex-1 min-w-0 md:max-w-sm">
        {/* ── Input ── */}
        <div className="relative">
          <MagnifyingGlass
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder="Search files and folders..."
            className={cn(
              "w-full h-9 pl-9 pr-16 rounded-xl text-sm",
              "bg-secondary border border-border text-foreground",
              "placeholder:text-muted-foreground",
              "focus:outline-none focus:ring-1 focus:ring-[#2da07a]/30 focus:border-[#2da07a]/50",
              "transition-all duration-150"
            )}
          />
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
              <kbd className="hidden sm:flex items-center px-1.5 py-0.5 rounded-md bg-muted border border-border text-[10px] text-muted-foreground font-mono">
                ⌘K
              </kbd>
            )}
          </div>
        </div>

        {/* ── Dropdown ── */}
        {showDropdown && (
          <div className="absolute top-11 left-0 right-0 z-50 bg-popover border border-border rounded-xl shadow-xl overflow-hidden">

            {/* ── Recent searches (shown when input is empty) ── */}
            {showRecents && (
              <div>
                <div className="flex items-center justify-between px-3 pt-3 pb-1">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Recent</p>
                  <button
                    onClick={() => { localStorage.removeItem(RECENT_KEY); setRecentSearches([]); }}
                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Clear all
                  </button>
                </div>
                {recentSearches.map((term) => (
                  <div key={term} className="flex items-center gap-2 px-3 py-2 hover:bg-accent transition-colors group">
                    <ClockCounterClockwise size={13} className="text-muted-foreground flex-shrink-0" />
                    <button
                      onClick={() => handleRecentClick(term)}
                      className="flex-1 text-sm text-foreground text-left truncate"
                    >
                      {term}
                    </button>
                    <button
                      onClick={() => { removeRecent(term); setRecentSearches(loadRecent()); }}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* ── Search results ── */}
            {showResults && !loading && !hasResults && (
              <div className="px-3 py-6 text-center">
                <p className="text-sm text-muted-foreground">No results for "{query}"</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Try a different search term</p>
              </div>
            )}

            {showResults && loading && (
              <div className="px-3 py-4 flex items-center justify-center gap-2">
                <Spinner size={14} className="text-muted-foreground animate-spin" />
                <p className="text-xs text-muted-foreground">Searching...</p>
              </div>
            )}

            {showResults && hasResults && (
              <>
                {/* Folders */}
                {folders.length > 0 && (
                  <div>
                    <p className="px-3 pt-3 pb-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                      Folders
                    </p>
                    {folders.map((result) => {
                      const idx = navIndex++;
                      return (
                        <button
                          key={result.id}
                          onClick={() => handleSelect(result)}
                          className={cn(
                            "w-full flex items-center gap-3 px-3 py-2 transition-colors text-left",
                            activeIndex === idx ? "bg-accent" : "hover:bg-accent"
                          )}
                        >
                          <FileIcon />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-foreground truncate">{result.name}</p>
                          </div>
                          <span className="text-xs text-muted-foreground flex-shrink-0">
                            {formatDate(result.created_at)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Files */}
                {files.length > 0 && (
                  <div>
                    <p className="px-3 pt-3 pb-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                      Files
                    </p>
                    {files.map((result) => {
                      const idx = navIndex++;
                      return (
                        <button
                          key={result.id}
                          onClick={() => handleSelect(result)}
                          className={cn(
                            "w-full flex items-center gap-3 px-3 py-2 transition-colors text-left",
                            activeIndex === idx ? "bg-accent" : "hover:bg-accent"
                          )}
                        >
                          <FileIcon mimeType={result.mime_type} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-foreground truncate">{result.name}</p>
                            {result.size !== undefined && (
                              <p className="text-[10px] text-muted-foreground">
                                {result.size < 1024 ** 2
                                  ? `${(result.size / 1024).toFixed(1)} KB`
                                  : `${(result.size / 1024 ** 2).toFixed(1)} MB`}
                              </p>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground flex-shrink-0">
                            {formatDate(result.created_at)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Footer */}
                <div className="px-3 py-2 border-t border-border flex items-center justify-between">
                  <p className="text-[10px] text-muted-foreground">
                    {results.length} result{results.length !== 1 ? "s" : ""}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    ↑↓ navigate · Enter to open
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── File preview dialog — rendered via portal to escape navbar stacking context ── */}
      {previewFile && createPortal(
        <FilePreviewDialog
          fileId={previewFile.id}
          fileName={previewFile.name}
          mimeType={previewFile.mimeType}
          onClose={() => setPreviewFile(null)}
        />,
        document.body
      )}
    </>
  );
}