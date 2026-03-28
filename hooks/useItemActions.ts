import { useState, useTransition } from "react";
import { toggleStar, trashItem, restoreItem, renameItem } from "@/actions/files";
import { useDownload } from "@/hooks/useDownload";

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

  const handleStar = () => startTransition(async () => { await toggleStar(id, type, isStarred); onRefresh?.(); });
  const handleTrash = () => startTransition(async () => { await trashItem(id, type); onRefresh?.(); });
  const handleRestore = () => startTransition(async () => { await restoreItem(id, type); onRefresh?.(); });
  
  const handleRename = () => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === name) { 
      setRenaming(false); 
      setNewName(name); 
      return; 
    }
    startTransition(async () => { 
      await renameItem(id, type, trimmed); 
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
