// components/DetailsDialog.tsx
"use client";

import { X } from "@phosphor-icons/react";
import { formatBytes, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface DetailsDialogProps {
  item: {
    id: string;
    name: string;
    type: "file" | "folder";
    mime_type?: string;
    size?: number;
    created_at: string;
    updated_at?: string;
    is_starred: boolean;
  };
  onClose: () => void;
}

export function DetailsDialog({ item, onClose }: DetailsDialogProps) {
  const details = [
    { label: "Name", value: item.name },
    { label: "Type", value: item.type === "folder" ? "Folder" : item.mime_type || "File" },
    { label: "Created", value: formatDate(item.created_at) },
    { label: "Modified", value: formatDate(item.updated_at || item.created_at) },
    ...(item.type === "file" && item.size !== undefined
      ? [{ label: "Size", value: formatBytes(item.size) }]
      : []),
    { label: "Status", value: item.is_starred ? "Starred" : "Normal" },
  ];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div 
        className="w-full max-w-sm bg-card border border-border shadow-2xl rounded-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50 bg-muted/20">
          <h2 className="text-sm font-bold text-foreground">Properties</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200"
          >
            <X size={16} weight="bold" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5">
            <div className="space-y-3">
                {details.map((detail, idx) => (
                    <div key={idx} className="flex items-start justify-between gap-4 text-xs">
                        <span className="text-muted-foreground font-medium shrink-0 pt-0.5">{detail.label}</span>
                        <span className="text-foreground font-semibold break-all text-right leading-relaxed">
                            {detail.value}
                        </span>
                    </div>
                ))}
            </div>

            {/* Technical Detail Section - more compact */}
            <div className="pt-4 border-t border-border/50">
                <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest">Technical ID</span>
                    <p className="text-[10px] font-mono text-muted-foreground/80 break-all bg-muted/40 p-2 rounded-lg border border-border/30">
                        {item.id}
                    </p>
                </div>
            </div>
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-1">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl text-xs font-bold bg-foreground text-background hover:opacity-90 active:scale-[0.98] transition-all shadow-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
