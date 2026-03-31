"use client";

import { useActivityLogsQuery } from "@/hooks/queries/useActivityLogsQuery";
import { 
  UploadSimple, 
  Trash, 
  ArrowsCounterClockwise, 
  PencilSimple, 
  FolderSimple, 
  Star,
  ShareNetwork,
  DownloadSimple,
  Clock,
  UserCircle,
  ShieldCheck,
  ShieldWarning
} from "@phosphor-icons/react";
import { formatTimeAgo, formatDate } from "@/lib/format";
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

export default function ActivityPage() {
  const { data: logs, isLoading } = useActivityLogsQuery(100);

  const hasLogs = logs && logs.length > 0;

  return (
    <div className="flex flex-col h-full p-4 md:p-8 max-w-5xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4 mb-10">
        <div className="p-4 rounded-3xl bg-primary/10 text-primary shadow-inner">
          <Clock size={32} weight="duotone" />
        </div>
        <div>
          <h1 className="text-3xl font-extrabold text-foreground tracking-tight">Activity History</h1>
          <p className="text-sm text-muted-foreground font-medium">Track all operations across your Nimbus drive</p>
        </div>
      </div>

      <div className="bg-background/40 backdrop-blur-md border border-border/60 rounded-[2.5rem] overflow-hidden shadow-2xl shadow-primary/5">
        <div className="p-6 bg-muted/30 border-b border-border/40 flex items-center justify-between">
          <h2 className="text-sm font-bold text-foreground">Recent Actions</h2>
          {hasLogs && (
            <span className="text-[10px] font-black uppercase tracking-widest bg-primary/10 text-primary px-3 py-1 rounded-full">
              {logs.length} Total
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="py-24 text-center space-y-5">
            <div className="relative inline-flex">
              <div className="animate-ping absolute inset-0 rounded-full h-10 w-10 bg-primary/20" />
              <div className="relative rounded-full h-10 w-10 border-4 border-primary border-t-transparent animate-spin" />
            </div>
            <p className="text-muted-foreground font-bold tracking-tight">Syncing your history...</p>
          </div>
        ) : !hasLogs ? (
          <div className="py-24 text-center space-y-6">
            <div className="mx-auto w-20 h-20 bg-muted/50 rounded-[2rem] flex items-center justify-center rotate-12 transition-transform hover:rotate-0 duration-500">
              <Clock size={40} weight="thin" className="text-muted-foreground/30" />
            </div>
            <div className="max-w-xs mx-auto">
              <p className="text-xl font-bold mb-2">Clean slate</p>
              <p className="text-sm text-muted-foreground leading-relaxed">Activities and operations will populate here as you use your drive.</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border/30 overflow-y-auto max-h-[calc(100vh-320px)] custom-scrollbar">
            {logs.map((log) => {
              const config = ACTION_MAP[log.action] || ACTION_MAP.upload;
              const Icon = config.icon;
              const resourceName = log.metadata?.name || log.metadata?.new_name || "Unknown Item";
              
              return (
                <div 
                  key={log.id} 
                  className="p-5 md:p-6 flex items-center gap-5 hover:bg-primary/[0.02] transition-colors"
                >
                  <div className={cn("p-3 rounded-2xl flex-shrink-0 shadow-lg shadow-black/5 ring-1 ring-black/5", config.color)}>
                    <Icon size={20} weight="duotone" />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-1.5">
                      <div className="text-sm font-bold text-foreground">
                        <span className="text-muted-foreground font-normal mr-1.5 uppercase tracking-wide text-[11px]">{config.label}</span>
                        <span className="truncate inline-block max-w-[200px] md:max-w-md align-bottom">{resourceName}</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground/80 font-bold bg-muted/80 backdrop-blur px-3 py-1 rounded-xl shadow-sm border border-border/40 ml-auto md:ml-0">
                        {formatDate(log.created_at)}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                       <span className="text-[11px] text-muted-foreground/60 font-semibold italic">
                        {formatTimeAgo(log.created_at)}
                      </span>
                      <span className="w-1.5 h-1.5 rounded-full bg-border/40" />
                      <span className="text-[9px] uppercase tracking-[0.15em] text-primary/60 font-black">
                        {log.resource_type}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
