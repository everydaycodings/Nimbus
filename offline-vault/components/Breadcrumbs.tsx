// offline-vault/components/Breadcrumbs.tsx
"use client";

import { CaretRight, House } from "@phosphor-icons/react";
import { useOfflineVault } from "../hooks/useOfflineVault";
import { cn } from "@/lib/utils";

const TEAL = "#2da07a";

interface Breadcrumb {
  id: string | null;
  name: string;
}

interface Props {
  currentFolderId: string | null;
  setCurrentFolderId: (id: string | null) => void;
  className?: string;
}

export default function Breadcrumbs({ currentFolderId, setCurrentFolderId, className }: Props) {
  const { files } = useOfflineVault();

  const getPath = () => {
    const path: Breadcrumb[] = [];
    let currentId = currentFolderId;

    while (currentId) {
      const folder = files.find((f) => f.id === currentId);
      if (folder) {
        path.unshift({ id: folder.id, name: folder.name });
        currentId = folder.parentId;
      } else {
        break;
      }
    }

    return path;
  };

  const path = getPath();

  return (
    <div className={cn("flex items-center gap-1 text-sm mb-4 flex-shrink-0 overflow-x-auto scrollbar-hide whitespace-nowrap", className)}>
      <button
        onClick={() => setCurrentFolderId(null)}
        className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 text-sm"
      >
        <House size={13} />
        <span>Vault</span>
      </button>

      {path.map((crumb, i) => (
        <span key={crumb.id || "root"} className="flex items-center gap-1">
          <CaretRight size={11} className="text-muted-foreground" />
          <button
            onClick={() => setCurrentFolderId(crumb.id)}
            className={cn(
              "transition-colors text-sm",
              i === path.length - 1
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {crumb.name}
          </button>
        </span>
      ))}
    </div>
  );
}
