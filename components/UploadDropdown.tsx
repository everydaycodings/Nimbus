"use client";

import { useState } from "react";
import {
  CloudArrowUp,
  FolderPlus,
  CaretDown,
  Plus,
} from "@phosphor-icons/react";
import { UploadFolderButton } from "@/components/UploadFolderButton";

const TEAL = "#2da07a";

type Props = {
  uploadMany: (files: FileList) => void;
  setShowCreateFolder: (v: boolean) => void;
  refresh: () => void;
};

export function ActionsDropdown({
  uploadMany,
  setShowCreateFolder,
  refresh,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      {/* 🔹 Trigger Button */}
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium 
        bg-secondary border border-border text-secondary-foreground 
        hover:bg-accent hover:text-accent-foreground 
        transition-all shadow-sm hover:shadow"
      >
        <Plus size={16} weight="bold" style={{ color: TEAL }} />
        New
        <CaretDown size={14} className="opacity-60" />
      </button>

      {/* 🔹 Dropdown */}
      {open && (
        <div
          className="absolute right-0 mt-2 w-52 rounded-xl border border-border 
          bg-popover shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95"
        >
          {/* Upload */}
          <label
            className="flex items-center gap-3 px-3 py-2.5 text-sm 
            hover:bg-accent cursor-pointer transition-colors"
          >
            <CloudArrowUp
              size={16}
              weight="duotone"
              style={{ color: TEAL }}
            />
            <span>Upload files</span>

            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) uploadMany(e.target.files);
                setOpen(false);
              }}
            />
          </label>

          {/* New Folder */}
          <button
            onClick={() => {
              setShowCreateFolder(true);
              setOpen(false);
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm 
            hover:bg-accent transition-colors"
          >
            <FolderPlus
              size={16}
              weight="duotone"
              style={{ color: TEAL }}
            />
            <span>New folder</span>
          </button>

          {/* Divider */}
          <div className="h-px bg-border my-1" />

          {/* Upload Folder */}
          <div className="px-3 py-2.5 hover:bg-accent transition-colors">
            <UploadFolderButton
              parentFolderId={null}
              onSuccess={() => {
                refresh();
                setOpen(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}