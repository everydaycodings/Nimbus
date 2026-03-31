// components/notification-bell.tsx
"use client";

import Link from "next/link";
import { 
  Bell, 
  UploadSimple, 
  Trash, 
  ArrowsCounterClockwise, 
  PencilSimple, 
  FolderSimple, 
  Star,
  ShareNetwork,
  DownloadSimple,
  UserCircle,
  ShieldCheck,
  ShieldWarning,
  CheckCircle,
  Clock
} from "@phosphor-icons/react";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { useActivityLogsQuery } from "@/hooks/queries/useActivityLogsQuery";
import { formatTimeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

const ACTION_MAP: Record<string, { icon: any, color: string, glow: string, label: string }> = {
  upload: { icon: UploadSimple, color: "text-sky-400 bg-sky-500/10", glow: "shadow-sky-500/20", label: "Uploaded" },
  download: { icon: DownloadSimple, color: "text-indigo-400 bg-indigo-500/10", glow: "shadow-indigo-500/20", label: "Downloaded" },
  delete: { icon: Trash, color: "text-rose-400 bg-rose-500/10", glow: "shadow-rose-500/20", label: "Deleted" },
  restore: { icon: ArrowsCounterClockwise, color: "text-emerald-400 bg-emerald-500/10", glow: "shadow-emerald-500/20", label: "Restored" },
  rename: { icon: PencilSimple, color: "text-amber-400 bg-amber-500/10", glow: "shadow-amber-500/20", label: "Renamed" },
  move: { icon: FolderSimple, color: "text-purple-400 bg-purple-500/10", glow: "shadow-purple-500/20", label: "Moved" },
  star: { icon: Star, color: "text-yellow-400 bg-yellow-500/10", glow: "shadow-yellow-500/20", label: "Starred" },
  unstar: { icon: Star, color: "text-slate-400 bg-slate-400/10", glow: "shadow-slate-400/20", label: "Unstarred" },
  share: { icon: ShareNetwork, color: "text-cyan-400 bg-cyan-500/10", glow: "shadow-cyan-500/20", label: "Shared" },
  unshare: { icon: ShareNetwork, color: "text-slate-500 bg-slate-500/10", glow: "shadow-slate-500/20", label: "Unshared" },
  profile_update: { icon: UserCircle, color: "text-green-400 bg-green-500/10", glow: "shadow-green-500/20", label: "Updated profile" },
  security_update: { icon: ShieldCheck, color: "text-orange-400 bg-orange-500/10", glow: "shadow-orange-500/20", label: "Security change" },
  mfa_enroll: { icon: ShieldCheck, color: "text-emerald-400 bg-emerald-500/10", glow: "shadow-emerald-500/20", label: "MFA enabled" },
  mfa_unenroll: { icon: ShieldWarning, color: "text-orange-400 bg-orange-500/10", glow: "shadow-orange-500/20", label: "MFA disabled" },
};

export function NotificationBell() {
  const { data: logs, isLoading } = useActivityLogsQuery(15);
  const hasLogs = logs && logs.length > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="relative flex items-center justify-center w-10 h-10 rounded-2xl text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-all duration-300 group outline-none ring-1 ring-transparent hover:ring-border/40">
          <Bell 
            size={20} 
            weight={"regular"}
            className={cn(
              "transition-all duration-300 group-hover:scale-110",
              hasLogs && ""
            )} 
          />
          {hasLogs && (
            <span className="absolute top-2.5 right-2.5 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/40 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary shadow-[0_0_10px_rgba(var(--primary),0.5)]"></span>
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      
      <DropdownMenuContent 
        align="end" 
        sideOffset={12}
        className="w-[380px] p-0 bg-background/60 backdrop-blur-2xl border-border/40 shadow-2xl rounded-[1.5rem] overflow-hidden transition-all data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2"
      >
        <DropdownMenuLabel className="p-5 bg-foreground/[0.02] border-b border-border/40">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                <Clock size={16} weight="bold" />
              </div>
              <span className="text-sm font-bold tracking-tight text-foreground">Recent Activity</span>
            </div>
            {hasLogs && (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary/5 border border-primary/10">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/40 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary"></span>
                </span>
                <span className="text-[10px] font-bold text-primary uppercase tracking-wider">{logs.length} Updates</span>
              </div>
            )}
          </div>
        </DropdownMenuLabel>
        
        <div className="max-h-[450px] overflow-y-auto overflow-x-hidden custom-scrollbar">
          {isLoading ? (
            <div className="py-20 text-center space-y-4">
              <div className="relative inline-flex">
                <div className="w-10 h-10 rounded-full border-t-2 border-r-2 border-primary animate-spin" />
                <div className="absolute inset-0 w-10 h-10 rounded-full border-2 border-primary/10" />
              </div>
              <p className="text-xs text-muted-foreground font-medium animate-pulse">Syncing activities...</p>
            </div>
          ) : !hasLogs ? (
            <div className="py-24 text-center space-y-4">
              <div className="mx-auto w-16 h-16 bg-muted/20 rounded-[1.5rem] flex items-center justify-center rotate-6">
                <Bell size={28} weight="thin" className="text-muted-foreground/30" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-bold text-foreground">All caught up</p>
                <p className="text-[11px] text-muted-foreground max-w-[200px] mx-auto leading-relaxed">
                  No activities recorded yet. Your actions will appear here.
                </p>
              </div>
            </div>
          ) : (
            <div className="py-1">
              {logs.map((log) => {
                const config = ACTION_MAP[log.action] || ACTION_MAP.upload;
                const Icon = config.icon;
                const resourceName = log.metadata?.name || log.metadata?.new_name || "Unknown Item";
                
                return (
                  <DropdownMenuItem 
                    key={log.id} 
                    className="px-5 py-4 cursor-default focus:bg-foreground/[0.03] outline-none transition-all border-b border-border/5 last:border-0 group/item"
                  >
                    <div className="flex gap-4 items-start w-full">
                      <div className={cn(
                        "p-2.5 rounded-2xl flex-shrink-0 transition-transform duration-300 group-hover/item:scale-110 shadow-lg",
                        config.color,
                        config.glow
                      )}>
                        <Icon size={18} weight="duotone" />
                      </div>
                      <div className="flex flex-col gap-1 min-w-0 flex-1">
                        <div className="text-sm leading-snug break-words">
                          <span className="text-muted-foreground font-medium mr-1.5">{config.label}</span>
                          <span className="text-foreground font-bold tracking-tight">{resourceName}</span>
                        </div>
                        <div className="flex items-center gap-2">
                           <span className="text-[10px] text-muted-foreground/50 font-medium">
                            {formatTimeAgo(log.created_at)}
                          </span>
                          <span className="w-1 h-1 rounded-full bg-border/40" />
                          <span className="text-[9px] font-black uppercase tracking-[0.1em] text-primary/50">
                            {log.resource_type}
                          </span>
                        </div>
                      </div>
                    </div>
                  </DropdownMenuItem>
                );
              })}
            </div>
          )}
        </div>
        
        <DropdownMenuSeparator className="m-0 opacity-20" />
        <div className="p-3 bg-foreground/[0.01]">
          <Link 
            href="/activity"
            className="flex items-center justify-center gap-2 text-[11px] font-bold text-muted-foreground hover:text-primary transition-all py-2.5 px-4 hover:bg-primary/5 rounded-xl w-full group/link"
          >
            <span>View All Activity</span>
            <CheckCircle size={14} className="opacity-0 group-hover/link:opacity-100 transition-opacity" />
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
