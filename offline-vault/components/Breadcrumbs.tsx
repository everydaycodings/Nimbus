// offline-vault/components/Breadcrumbs.tsx
"use client";

import { CaretRight, House } from "@phosphor-icons/react";
import { useOfflineVault } from "../hooks/useOfflineVault";

const TEAL = "#2da07a";

interface Breadcrumb {
  id: string | null;
  name: string;
}

interface Props {
  currentFolderId: string | null;
  setCurrentFolderId: (id: string | null) => void;
}

export default function Breadcrumbs({ currentFolderId, setCurrentFolderId }: Props) {
  const { files } = useOfflineVault();

  // Compute the path from current folder to root
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

    path.unshift({ id: null, name: "Root" });
    return path;
  };

  const path = getPath();

  return (
    <nav className="flex items-center gap-1.5 overflow-x-auto whitespace-nowrap px-4 py-2 bg-secondary/20 rounded-2xl border border-border/40 scrollbar-hide max-w-full">
      {path.map((crumb, index) => (
        <div key={crumb.id || "root"} className="flex items-center gap-1.5 group">
          {index > 0 && <CaretRight size={12} className="text-muted-foreground opacity-40 shrink-0" />}
          <button
            onClick={() => setCurrentFolderId(crumb.id)}
            className={`text-xs font-bold transition-all px-2 py-1 rounded-lg hover:bg-secondary/60 flex items-center gap-1.5 ${
              index === path.length - 1 ? "text-foreground bg-card shadow-sm border border-border/60" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {crumb.id === null && <House size={14} weight="fill" style={{ color: TEAL }} />}
            {crumb.name}
          </button>
        </div>
      ))}
    </nav>
  );
}
