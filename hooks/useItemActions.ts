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
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showTrashDialog, setShowTrashDialog] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
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
  
  const handleMainClick = (onFolderOpen?: (id: string, name: string) => void) => {
    if (type === "file") setShowPreview(true);
    if (type === "folder") onFolderOpen?.(id, name);
  };

  const handleDownload = () => download(id, name);

  return {
    showMoveDialog, setShowMoveDialog,
    showRenameDialog, setShowRenameDialog,
    showTrashDialog, setShowTrashDialog,
    showPreview, setShowPreview,
    showShare, setShowShare,
    showDetails, setShowDetails,
    isPending,
    isDownloading,
    handleStar,
    handleTrash,
    handleRestore,
    handleMainClick,
    handleDownload,
  };
}
