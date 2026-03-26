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
        "relative flex flex-col",
        isDragging && "bg-[#2da07a]/5 ring-2 ring-inset ring-[#2da07a]/30 rounded-xl"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* ✅ Upload Button */}
      <div className={cn("px-3 mb-4", !open && "px-2")}>
        <button
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "flex items-center gap-2.5 w-full rounded-xl px-3 py-2.5 text-sm font-medium",
            "bg-secondary border border-border text-secondary-foreground",
            "hover:bg-accent hover:text-accent-foreground",
            "transition-all duration-150",
            !open && "justify-center px-0"
          )}
        >
          <CloudArrowUp
            size={18}
            weight="duotone"
            style={{ color: "#2da07a" }}
            className="flex-shrink-0"
          />
          {open && <span>Upload files</span>}
        </button>

        {/* Hidden input */}
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

      {/* ── Drag Overlay ── */}
      {isDragging && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-2">
            <CloudArrowUp
              size={40}
              weight="duotone"
              style={{ color: "#2da07a" }}
            />
            <p className="text-sm font-medium" style={{ color: "#2da07a" }}>
              Drop files to upload
            </p>
          </div>
        </div>
      )}
    </div>
  );
}