// components/Sidebar.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  House,
  FolderSimple,
  Star,
  Trash,
  CaretDoubleLeft,
  CaretDoubleRight,
  CloudArrowUp,
  Clock,
  HardDrive,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

const navItems = [
  { name: "Home",     icon: House,         href: "/"        },
  { name: "My Files", icon: FolderSimple,  href: "/files"   },
  { name: "Recent",   icon: Clock,         href: "/recent"  },
  { name: "Starred",  icon: Star,          href: "/starred" },
  { name: "Trash",    icon: Trash,         href: "/trash"   },
];

const TEAL     = "#2da07a";
const TEAL_DIM = "rgba(45,160,122,0.12)";

function formatBytes(bytes: number) {
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

interface SidebarProps {
  storageUsed:  number; // bytes
  storageLimit: number; // bytes
}

export function Sidebar({ storageUsed, storageLimit }: SidebarProps) {
  const [open, setOpen] = useState(true);
  const pathname        = usePathname();

  const usedPct  = Math.min(100, Math.round((storageUsed / storageLimit) * 100));
  const usedFmt  = formatBytes(storageUsed);
  const limitFmt = formatBytes(storageLimit);

  // Colour shifts to red when > 90%
  const barColor = usedPct >= 90 ? "#ef4444" : TEAL;

  return (
    <aside
      className={cn(
        "relative flex flex-col h-screen border-r border-border bg-background transition-all duration-300 ease-in-out select-none",
        open ? "w-60" : "w-[68px]"
      )}
    >
      {/* ── Logo ── */}
      <div
        className={cn(
          "flex items-center gap-2.5 px-4 pt-5 pb-4",
          !open && "justify-center px-0"
        )}
      >
        <div
          className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: TEAL }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
            <path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
          </svg>
        </div>
        {open && (
          <span className="text-[15px] font-bold tracking-tight text-foreground">
            Nimbus
          </span>
        )}
      </div>

      {/* ── Upload Button ── */}
      <div className={cn("px-3 mb-5", !open && "px-2")}>
        <button
          className={cn(
            "flex items-center gap-2.5 w-full rounded-xl px-3 py-2.5 text-sm font-medium",
            "bg-secondary border border-border text-secondary-foreground",
            "hover:bg-accent hover:text-accent-foreground",
            "transition-all duration-150",
            !open && "justify-center px-0"
          )}
        >
          <CloudArrowUp size={18} weight="duotone" style={{ color: TEAL }} className="flex-shrink-0" />
          {open && <span>Upload files</span>}
        </button>
      </div>

      {/* ── Nav ── */}
      <nav className="flex flex-col gap-0.5 px-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              title={!open ? item.name : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all duration-150",
                isActive
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                !open && "justify-center px-0 py-2.5"
              )}
              style={isActive ? { backgroundColor: TEAL_DIM } : {}}
            >
              <item.icon
                size={19}
                weight={isActive ? "fill" : "duotone"}
                className="flex-shrink-0 transition-colors duration-150"
                style={isActive ? { color: TEAL } : {}}
              />
              {open && <span className="truncate">{item.name}</span>}
              {isActive && open && (
                <span
                  className="ml-auto w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: TEAL }}
                />
              )}
            </Link>
          );
        })}
      </nav>

      {/* ── Divider ── */}
      <div className={cn("px-3 mt-4", !open && "px-2")}>
        <div className="border-t border-border" />
      </div>

      {/* ── Storage Bar ── */}
      {open ? (
        <div className="px-3 mt-4">
          <div className="flex items-center gap-2 mb-2">
            <HardDrive size={15} weight="duotone" className="text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">Storage</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {usedFmt} / {limitFmt}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${usedPct}%`, backgroundColor: barColor }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {usedPct}% used
            {usedPct >= 90 && (
              <span className="ml-1 text-red-400 font-medium">— storage almost full</span>
            )}
          </p>
        </div>
      ) : (
        <div className="flex justify-center mt-4">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center"
            title={`${usedFmt} / ${limitFmt} used`}
            style={{
              background: `conic-gradient(${barColor} ${usedPct * 3.6}deg, var(--muted) 0deg)`,
            }}
          >
            <div className="w-5 h-5 bg-background rounded-full" />
          </div>
        </div>
      )}

      {/* ── Collapse Toggle ── */}
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "absolute -right-3 top-6 z-10",
          "flex items-center justify-center",
          "w-6 h-6 rounded-full bg-background border border-border shadow-sm",
          "text-muted-foreground transition-all duration-150"
        )}
        onMouseEnter={e => {
          e.currentTarget.style.color        = TEAL;
          e.currentTarget.style.borderColor  = `${TEAL}66`;
        }}
        onMouseLeave={e => {
          e.currentTarget.style.color        = "";
          e.currentTarget.style.borderColor  = "";
        }}
        aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
      >
        {open
          ? <CaretDoubleLeft  size={11} weight="bold" />
          : <CaretDoubleRight size={11} weight="bold" />
        }
      </button>
    </aside>
  );
}