import { useState, useTransition } from "react";
import { toggleStar, trashItem, restoreItem, renameItem } from "@/actions/files";
import { useDownload } from "@/hooks/useDownload";
import { toast } from "sonner";

interface UseItemActionsProps {
  id: string;
  name: string;
  type: "file" | "folder";
  isStarred: boolean;
  onRefresh?: () => void;
}

export function useItemActions({ id, name, type, isStarred, onRefresh }: UseItemActionsProps) {
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(name);
  const [isPending, startTransition] = useTransition();
  
  const { download, downloading } = useDownload();
  const isDownloading = downloading.has(id);

  const handleStar = () => startTransition(async () => { 
    try { await toggleStar(id, type, isStarred); toast.success(isStarred ? "Unstarred" : "Starred"); } catch { toast.error("Failed to update star"); } 
    onRefresh?.(); 
  });
  const handleTrash = () => startTransition(async () => { 
    try { await trashItem(id, type); toast.success("Moved to trash"); } catch { toast.error("Failed to trash item"); } 
    onRefresh?.(); 
  });
  const handleRestore = () => startTransition(async () => { 
    try { await restoreItem(id, type); toast.success("Restored item"); } catch { toast.error("Failed to restore item"); } 
    onRefresh?.(); 
  });
  
  const handleRename = () => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === name) { 
      setRenaming(false); 
      setNewName(name); 
      return; 
    }
    startTransition(async () => { 
      try {
        await renameItem(id, type, trimmed); 
        toast.success("Renamed successfully");
      } catch {
        toast.error("Failed to rename item");
      }
      setRenaming(false); 
      onRefresh?.(); 
    });
  };

  const handleMainClick = (onFolderOpen?: (id: string, name: string) => void) => {
    if (renaming) return;
    if (type === "file") setShowPreview(true);
    if (type === "folder") onFolderOpen?.(id, name);
  };

  const handleDownload = () => download(id, name);

  return {
    showMoveDialog, setShowMoveDialog,
    showPreview, setShowPreview,
    showShare, setShowShare,
    renaming, setRenaming,
    newName, setNewName,
    isPending,
    isDownloading,
    handleStar,
    handleTrash,
    handleRestore,
    handleRename,
    handleMainClick,
    handleDownload,
  };
}
