"use client";

import { File, Image, FilePdf, VideoIcon, MusicNote, FileVideo } from "@phosphor-icons/react";

export function FileIcon({ mimeType, size = 20 }: { mimeType: string; size?: number }) {
  if (mimeType.startsWith("image/")) return <Image size={size} weight="duotone" className="text-purple-400" />;
  if (mimeType.startsWith("video/")) {
    // OpenVault originally used FileVideo, while regular uses VideoIcon. 
    // We'll standardize on VideoIcon to minimize icon variation unless FileVideo is preferred. 
    // Let's use VideoIcon as the standard, but we'll include FileVideo in the imports just in case.
    return <VideoIcon size={size} weight="duotone" className="text-blue-400" />;
  }
  if (mimeType.startsWith("audio/")) return <MusicNote size={size} weight="duotone" className="text-pink-400" />;
  if (mimeType === "application/pdf") return <FilePdf size={size} weight="duotone" className="text-red-400" />;
  
  return <File size={size} weight="duotone" className="text-muted-foreground" />;
}
