"use client";

import { useState, useRef } from "react";
import { CloudArrowUp } from "@phosphor-icons/react";
import { useUpload } from "@/hooks/useUpload";
import { cn } from "@/lib/utils";

interface Props {
  parentFolderId?: string;
  onUploadComplete?: () => void;
  open?: boolean;
}

export function UploadZone({
  parentFolderId,
  onUploadComplete,
  open = true,
}: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ✅ UPDATED: no uploadingFiles anymore
  const { uploadMany } = useUpload({
    parentFolderId,
    onSuccess: onUploadComplete,
  });

  // ── Drag & Drop ─────────────────────────
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (e.dataTransfer.files.length > 0) {
      uploadMany(e.dataTransfer.files);
    }
  };

  return (
    <div
      className={cn(
        "relative flex flex-col transition-all duration-200",
        isDragging && "scale-[1.01]"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* ✅ Upload Button */}
      <div className={cn("px-3 mb-4", !open && "px-2 flex justify-center")}>
  <button
    onClick={() => fileInputRef.current?.click()}
    title={!open ? "Upload files" : undefined}
    className={cn(
      "flex items-center gap-2.5 rounded-xl text-sm font-medium",
      "bg-secondary border border-border text-secondary-foreground",
      "hover:bg-accent hover:text-accent-foreground",
      "transition-all duration-150",

      // ✅ OPEN
      open && "w-full px-3 py-2.5",

      // ✅ CLOSED (THIS WAS MISSING)
      !open && "w-10 h-10 justify-center p-0"
    )}
  >
    <CloudArrowUp
      size={18}
      weight="duotone"
      style={{ color: "#2da07a" }}
    />

    {open && <span>Upload files</span>}
  </button>

  <input
    ref={fileInputRef}
    type="file"
    multiple
    className="hidden"
    onChange={(e) => {
      if (e.target.files) {
        uploadMany(e.target.files);
        e.target.value = "";
      }
    }}
  />
</div>
  
      {/* 🌟 DRAG OVERLAY (UPGRADED) */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center">
          
          {/* Background blur + tint */}
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm rounded-xl" />
  
          {/* Center Card */}
          <div className="relative flex flex-col items-center gap-3 px-6 py-5 rounded-2xl border border-white/10 bg-background/80 backdrop-blur-md shadow-2xl animate-in fade-in zoom-in-95">
            
            {/* Icon */}
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{ backgroundColor: "rgba(45,160,122,0.15)" }}
            >
              <CloudArrowUp
                size={26}
                weight="duotone"
                style={{ color: "#2da07a" }}
              />
            </div>
  
            {/* Text */}
            <div className="text-center">
              <p className="text-sm font-semibold text-foreground">
                Drop files to upload
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Release to start uploading instantly
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}