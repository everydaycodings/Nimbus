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
  ShieldWarning
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

const ACTION_MAP: Record<string, { icon: any, color: string, label: string }> = {
  upload: { icon: UploadSimple, color: "text-blue-500 bg-blue-500/10", label: "Uploaded" },
  download: { icon: DownloadSimple, color: "text-indigo-500 bg-indigo-500/10", label: "Downloaded" },
  delete: { icon: Trash, color: "text-red-500 bg-red-500/10", label: "Deleted" },
  restore: { icon: ArrowsCounterClockwise, color: "text-green-500 bg-green-500/10", label: "Restored" },
  rename: { icon: PencilSimple, color: "text-amber-500 bg-amber-500/10", label: "Renamed" },
  move: { icon: FolderSimple, color: "text-purple-500 bg-purple-500/10", label: "Moved" },
  star: { icon: Star, color: "text-yellow-500 bg-yellow-500/10", label: "Starred" },
  unstar: { icon: Star, color: "text-slate-400 bg-slate-400/10", label: "Unstarred" },
  share: { icon: ShareNetwork, color: "text-cyan-500 bg-cyan-500/10", label: "Shared" },
  unshare: { icon: ShareNetwork, color: "text-slate-500 bg-slate-500/10", label: "Unshared" },
  profile_update: { icon: UserCircle, color: "text-emerald-500 bg-emerald-500/10", label: "Updated profile" },
  security_update: { icon: ShieldCheck, color: "text-rose-500 bg-rose-500/10", label: "Security change" },
  mfa_enroll: { icon: ShieldCheck, color: "text-green-500 bg-green-500/10", label: "MFA enabled" },
  mfa_unenroll: { icon: ShieldWarning, color: "text-amber-500 bg-amber-500/10", label: "MFA disabled" },
};

export function NotificationBell() {
  const { data: logs, isLoading } = useActivityLogsQuery(15);
  const hasLogs = logs && logs.length > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="relative flex items-center justify-center w-9 h-9 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200 group outline-none">
          <Bell size={17} weight="duotone" className="group-hover:scale-110 transition-transform" />
          {hasLogs && (
            <span className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full  bg-[#2da07a] ring-2 ring-background border-primary shadow-[0_0_8px_rgba(45,160,122,0.5)]" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent 
        align="end" 
        className="w-80 md:w-96 p-0 border-border/50 bg-background/95 backdrop-blur-xl shadow-2xl rounded-2xl overflow-hidden animate-in fade-in zoom-in duration-200"
      >
        <DropdownMenuLabel className="p-4 bg-muted/30 border-b border-border/40">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold tracking-tight">Recent Activity</span>
            {hasLogs && <span className="text-[10px] font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full">{logs.length} updates</span>}
          </div>
        </DropdownMenuLabel>
        
        <div className="max-h-[70vh] overflow-y-auto overflow-x-hidden custom-scrollbar">
          {isLoading ? (
            <div className="p-8 text-center space-y-3">
              <div className="inline-flex animate-spin rounded-full h-5 w-5 border-2 border-primary border-t-transparent" />
              <p className="text-xs text-muted-foreground font-medium">Updating logs...</p>
            </div>
          ) : !hasLogs ? (
            <div className="p-10 text-center space-y-3">
              <div className="mx-auto w-12 h-12 bg-muted/50 rounded-2xl flex items-center justify-center">
                <Bell size={24} weight="thin" className="text-muted-foreground/50" />
              </div>
              <p className="text-xs text-muted-foreground font-medium">No recent activity found</p>
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
                    className="px-4 py-3 cursor-default focus:bg-accent/50 outline-none transition-colors border-b border-border/10 last:border-0"
                  >
                    <div className="flex gap-3 items-start w-full">
                      <div className={cn("p-2 rounded-xl mt-0.5 flex-shrink-0", config.color)}>
                        <Icon size={16} weight="duotone" />
                      </div>
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="text-xs leading-relaxed break-words font-medium">
                          <span className="text-muted-foreground font-normal">{config.label} </span>
                          <span className="text-foreground">{resourceName}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground/60 font-medium">
                          {formatTimeAgo(log.created_at)}
                        </span>
                      </div>
                    </div>
                  </DropdownMenuItem>
                );
              })}
            </div>
          )}
        </div>
        
        <DropdownMenuSeparator className="m-0 opacity-40" />
        <div className="p-2.5 text-center">
          <Link 
            href="/activity"
            className="block text-[11px] font-bold text-primary hover:text-primary/80 transition-colors py-1 px-4 hover:bg-primary/5 rounded-lg w-full"
          >
            View All Activity
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
