"use client";

import { File, Image, FilePdf, VideoIcon, MusicNote, FileVideo } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export function FileIcon({ mimeType, size = 20, className }: { mimeType: string; size?: number; className?: string }) {
  if (mimeType.startsWith("image/")) return <Image size={size} weight="duotone" className={cn("text-purple-400", className)} />;
  if (mimeType.startsWith("video/")) {
    return <VideoIcon size={size} weight="duotone" className={cn("text-blue-400", className)} />;
  }
  if (mimeType.startsWith("audio/")) return <MusicNote size={size} weight="duotone" className={cn("text-pink-400", className)} />;
  if (mimeType === "application/pdf") return <FilePdf size={size} weight="duotone" className={cn("text-red-400", className)} />;
  
  return <File size={size} weight="duotone" className={cn("text-muted-foreground", className)} />;
}
