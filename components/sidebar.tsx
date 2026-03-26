"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { calculateStorageUsage } from "@/lib/storage";
import {
  House,
  FolderSimple,
  Star,
  Trash,
  CaretDoubleLeft,
  CaretDoubleRight,
  Clock,
  HardDrive,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { UploadZone } from "@/components/UploadZone"; // ✅ NEW
import { StorageUsage } from "./StorageUsage";
import { getFiles } from "@/actions/files";

const navItems = [
  { name: "Home", icon: House, href: "/" },
  { name: "My Files", icon: FolderSimple, href: "/files" },
  { name: "Recent", icon: Clock, href: "/recent" },
  { name: "Starred", icon: Star, href: "/starred" },
  { name: "Trash", icon: Trash, href: "/trash" },
];

const TEAL = "#2da07a";
const TEAL_DIM = "rgba(45,160,122,0.12)";

function formatBytes(bytes: number) {
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

interface SidebarProps {
  storageUsed: number;
  storageLimit: number;
}


export function Sidebar({ storageUsed, storageLimit }: SidebarProps) {
  const [open, setOpen] = useState(true);
  const pathname = usePathname();
  const router = useRouter(); // ✅ NEW

  const [files, setFiles] = useState<any[]>([]);

  useEffect(() => {
    getFiles(null).then((data) => setFiles(data.files));
  }, []);

  const {
    imageBytes,
    videoBytes,
    docBytes,
    otherBytes,
  } = calculateStorageUsage(files);

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

      {/* <div className={cn("px-3 mb-5", !open && "px-2")}>
        <UploadZone
          open={open} // ✅ THIS FIXES IT
          onUploadComplete={() => router.refresh()}
        />
      </div> */}

      {/* ── Navigation ── */}
      <nav className="flex flex-col gap-0.5 px-2 my-5">
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

      <StorageUsage
        total={storageLimit}
        used={storageUsed}
        open={open}
        categories={[
          { label: "Images", size: imageBytes, color: "#22c55e" },
          { label: "Videos", size: videoBytes, color: "#3b82f6" },
          { label: "Docs", size: docBytes, color: "#eab308" },
          { label: "Other", size: otherBytes, color: "#ef4444" },
        ]}
      />

      {/* ── Collapse Button ── */}
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "absolute -right-3 top-6 z-10",
          "flex items-center justify-center",
          "w-6 h-6 rounded-full bg-background border border-border shadow-sm",
          "text-muted-foreground transition-all duration-150"
        )}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = TEAL;
          e.currentTarget.style.borderColor = `${TEAL}66`;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "";
          e.currentTarget.style.borderColor = "";
        }}
        aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
      >
        {open ? (
          <CaretDoubleLeft size={11} weight="bold" />
        ) : (
          <CaretDoubleRight size={11} weight="bold" />
        )}
      </button>
    </aside>
  );
}