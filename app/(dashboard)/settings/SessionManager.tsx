"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { CircleNotch, Laptop, DeviceMobile, Trash, SignOut, Globe, ShieldCheck } from "@phosphor-icons/react";
import { getUserSessions, revokeSession, revokeOtherSessions } from "@/app/actions/sessions";
import { parseUserAgent } from "@/lib/device-info";
import { formatTimeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

export function SessionManager() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const data = await getUserSessions();
      setSessions(data.sessions);
      setCurrentSessionId(data.currentSessionId || null);
    } catch (error: any) {
      console.error(error);
      toast.error("Failed to load active sessions");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleRevoke = async (id: string) => {
    setIsActionLoading(id);
    try {
      await revokeSession(id);
      toast.success("Session revoked successfully");
      await fetchSessions();
    } catch (error: any) {
      toast.error(error.message || "Failed to revoke session");
    } finally {
      setIsActionLoading(null);
    }
  };

  const handleRevokeOthers = async () => {
    if (!currentSessionId) return;
    setIsActionLoading("all");
    try {
      await revokeOtherSessions(currentSessionId);
      toast.success("Other sessions revoked successfully");
      await fetchSessions();
    } catch (error: any) {
      toast.error(error.message || "Failed to revoke other sessions");
    } finally {
      setIsActionLoading(null);
    }
  };

  if (isLoading) {
    return (
      <Card className="border-border/40 bg-background/60 backdrop-blur-xl shadow-lg">
        <CardContent className="pt-10 pb-10 flex flex-col items-center justify-center space-y-4">
          <CircleNotch size={32} className="animate-spin text-primary" />
          <p className="text-sm text-muted-foreground animate-pulse">Loading active sessions...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="group overflow-hidden border-border/40 bg-background/60 backdrop-blur-xl shadow-lg hover:shadow-xl transition-all duration-300 relative">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-400 to-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      <CardHeader className="pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-3 text-xl">
              <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-500 group-hover:bg-blue-500/20 group-hover:scale-110 transition-all duration-300">
                <ShieldCheck size={22} weight="duotone" />
              </div>
              Logged-in Devices
            </CardTitle>
            <CardDescription className="text-sm">
              Manage your active sessions and log out from other devices.
            </CardDescription>
          </div>
          {sessions.length > 1 && (
            <Button 
              variant="outline" 
              size="sm" 
              className="text-xs h-9 gap-2 border-destructive/20 hover:border-destructive/40 hover:bg-destructive/5 text-destructive transition-all"
              onClick={handleRevokeOthers}
              disabled={!!isActionLoading}
            >
              {isActionLoading === "all" ? (
                <CircleNotch size={14} className="animate-spin" />
              ) : (
                <SignOut size={14} />
              )}
              Log out other devices
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {sessions.map((session) => {
          const { browser, os, device } = parseUserAgent(session.user_agent || "");
          const isCurrent = session.id === currentSessionId;
          
          return (
            <div 
              key={session.id} 
              className={cn(
                "flex items-center justify-between p-4 rounded-2xl border transition-all duration-300",
                isCurrent 
                  ? "bg-primary/5 border-primary/20 shadow-sm" 
                  : "bg-muted/30 border-transparent hover:border-border/60 hover:bg-muted/50"
              )}
            >
              <div className="flex items-center gap-4">
                <div className={cn(
                  "p-3 rounded-xl flex items-center justify-center shadow-sm",
                  isCurrent ? "bg-primary text-primary-foreground" : "bg-background border border-border text-muted-foreground"
                )}>
                  {device === "Mobile" ? (
                    <DeviceMobile size={22} weight={isCurrent ? "fill" : "regular"} />
                  ) : (
                    <Laptop size={22} weight={isCurrent ? "fill" : "regular"} />
                  )}
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm md:text-base">
                      {browser} on {os}
                    </span>
                    {isCurrent && (
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/10">
                        Current
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1.5 opacity-70">
                      <Globe size={12} />
                      {session.ip || "Unknown IP"}
                    </span>
                    <span className="hidden sm:block w-1 h-1 rounded-full bg-muted-foreground/30" />
                    <span>{formatTimeAgo(session.created_at)}</span>
                  </div>
                </div>
              </div>
              
              {!isCurrent && (
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="rounded-full hover:bg-destructive/10 hover:text-destructive group/btn h-9 w-9 transition-colors flex-shrink-0"
                  onClick={() => handleRevoke(session.id)}
                  disabled={!!isActionLoading}
                  title="Log out of this device"
                >
                  {isActionLoading === session.id ? (
                    <CircleNotch size={18} className="animate-spin text-destructive" />
                  ) : (
                    <Trash size={18} className="group-hover/btn:scale-110 transition-transform" />
                  )}
                </Button>
              )}
            </div>
          );
        })}

        {sessions.length === 0 && (
          <div className="text-center py-12 space-y-3 grayscale opacity-60">
            <div className="inline-flex p-4 rounded-full bg-muted/50 border border-dashed border-border gap-2">
              <ShieldCheck size={32} className="text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground font-medium">No active sessions found.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
