// lib/format.ts

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", 
    day: "numeric", 
    year: "numeric",
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function fmtTime(s: number): string {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function getExpiryLabel(expiresAt: string | null): string {
  if (!expiresAt) return "Never expires";
  const exp  = new Date(expiresAt);
  const now  = new Date();
  const diff = exp.getTime() - now.getTime();
  if (diff <= 0) return "Expired";

  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);

  if (mins  < 60)  return `Expires in ${mins}m`;
  if (hours < 24)  return `Expires in ${hours}h`;
  if (days  < 30)  return `Expires in ${days}d`;
  return `Expires ${exp.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}
