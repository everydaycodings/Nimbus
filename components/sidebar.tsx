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
  VaultIcon,
  ShareNetworkIcon,
  CloudIcon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { UploadZone } from "@/components/UploadZone";
import { StorageUsage } from "./StorageUsage";
import { getFiles } from "@/actions/files";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { useMobileSidebar } from "@/hooks/useSidebarMobile";


const navItems = [
  { name: "Home", icon: House, href: "/" },
  { name: "My Files", icon: FolderSimple, href: "/files" },
  { name: "Private Vault", icon: VaultIcon, href: "/vault" },
  { name: "Recent", icon: Clock, href: "/recent" },
  { name: "Starred", icon: Star, href: "/starred" },
  { name: "Sharing", icon: ShareNetworkIcon, href: "/sharing" },
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
      <Link href="/" className="block">
        <div
          className={cn(
            "flex items-center gap-2.5 px-4 pt-5 pb-4 cursor-pointer",
            !open && "justify-center px-0"
          )}
        >
          <div
            className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: TEAL }}
          >
            <CloudIcon size={16} weight="bold" className="text-white" />
          </div>

          {open && (
            <span className="text-[15px] font-bold tracking-tight text-foreground">
              Nimbus
            </span>
          )}
        </div>
      </Link>

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

          if (item.name === "My Files") {
            return (
              <button
                key={item.name}
                onClick={() => {
                  router.push("/files"); // 🔥 HERE
                }}
                className={cn(
                  "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all duration-150 w-full text-left cursor-pointer",
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
                  style={isActive ? { color: TEAL } : {}}
                />

                {open && <span className="truncate">{item.name}</span>}
              </button>
            );
          }

          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all duration-150",
                isActive
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                !open && "justify-center px-0 py-2.5"
              )}
              style={isActive ? { backgroundColor: TEAL_DIM } : {}}
            >
              <item.icon size={19} />
              {open && <span>{item.name}</span>}
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

// ═══════════════════════════════════════════════════════════════
// Mobile Sidebar — Sheet overlay for small screens
// ═══════════════════════════════════════════════════════════════
export function MobileSidebar({ storageUsed, storageLimit }: SidebarProps) {
  const { isOpen, close } = useMobileSidebar();
  const pathname = usePathname();
  const router = useRouter();

  const [files, setFiles] = useState<any[]>([]);

  useEffect(() => {
    getFiles(null).then((data) => setFiles(data.files));
  }, []);

  const { imageBytes, videoBytes, docBytes, otherBytes } =
    calculateStorageUsage(files);

  // Auto-close when navigating
  useEffect(() => {
    close();
  }, [pathname, close]);

  return (
    <Sheet open={isOpen} onOpenChange={(v) => !v && close()}>
      <SheetContent side="left" className="w-64 p-0" showCloseButton={false}>
        <SheetTitle className="sr-only">Navigation</SheetTitle>

        {/* Logo */}
        <Link href="/" className="block" onClick={close}>
          <div className="flex items-center gap-2.5 px-4 pt-5 pb-4 cursor-pointer">
            <div
              className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: TEAL }}
            >
              <CloudIcon size={16} weight="bold" className="text-white" />
            </div>
            <span className="text-[15px] font-bold tracking-tight text-foreground">
              Nimbus
            </span>
          </div>
        </Link>

        {/* Navigation */}
        <nav className="flex flex-col gap-0.5 px-2 my-5">
          {navItems.map((item) => {
            const isActive = pathname === item.href;

            if (item.name === "My Files") {
              return (
                <button
                  key={item.name}
                  onClick={() => {
                    router.push("/files");
                    close();
                  }}
                  className={cn(
                    "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all duration-150 w-full text-left cursor-pointer",
                    isActive
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                  style={isActive ? { backgroundColor: TEAL_DIM } : {}}
                >
                  <item.icon
                    size={19}
                    weight={isActive ? "fill" : "duotone"}
                    style={isActive ? { color: TEAL } : {}}
                  />
                  <span className="truncate">{item.name}</span>
                </button>
              );
            }

            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={close}
                className={cn(
                  "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all duration-150",
                  isActive
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
                style={isActive ? { backgroundColor: TEAL_DIM } : {}}
              >
                <item.icon size={19} />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* Divider */}
        <div className="px-3 mt-4">
          <div className="border-t border-border" />
        </div>

        <StorageUsage
          total={storageLimit}
          used={storageUsed}
          open={true}
          categories={[
            { label: "Images", size: imageBytes, color: "#22c55e" },
            { label: "Videos", size: videoBytes, color: "#3b82f6" },
            { label: "Docs", size: docBytes, color: "#eab308" },
            { label: "Other", size: otherBytes, color: "#ef4444" },
          ]}
        />
      </SheetContent>
    </Sheet>
  );
}