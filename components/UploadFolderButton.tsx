// components/UploadFolderButton.tsx
// Drop-in button that triggers folder upload via webkitdirectory
"use client";

import { useRef } from "react";
import { FoldersIcon } from "@phosphor-icons/react";
import { useFolderUpload } from "@/hooks/useFolderUpload";
import { cn } from "@/lib/utils";

const TEAL = "#2da07a";

interface Props {
  parentFolderId?: string | null;
  onSuccess?:      () => void;
  onSelect?:       () => void; 
  onCancel?:       () => void;
  className?:      string;
  variant?:        "default" | "ghost";
}

export function UploadFolderButton({
  parentFolderId,
  onSuccess,
  onSelect,
  className,
  variant = "default",
}: Props) {
  const inputRef         = useRef<HTMLInputElement>(null);
  const { uploadFolder } = useFolderUpload({ parentFolderId, onSuccess });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    // The browser shows its own confirmation here for webkitdirectory
    uploadFolder(e.target.files);
    onSelect?.();
    
    // Reset so the same folder can be re-selected
    e.target.value = "";
  };

  return (
    <>
      {/* Hidden input — webkitdirectory allows selecting a folder */}
      <input
        ref={inputRef}
        type="file"
        // @ts-ignore — webkitdirectory is non-standard but widely supported
        webkitdirectory=""
        multiple
        className="hidden"
        onChange={handleChange}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all w-full",
          variant === "default"
            ? "bg-secondary border border-border text-secondary-foreground hover:bg-accent hover:text-accent-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-accent justify-start",
          className
        )}
      >
        <FoldersIcon size={16} weight="duotone" style={{ color: TEAL }} />
        <span>Upload folder</span>
      </button>
    </>
  );
}