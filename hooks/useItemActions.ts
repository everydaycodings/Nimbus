// hooks/useItemActions.ts
import { useState } from "react";
import { useDownload } from "@/hooks/useDownload";
import { toast } from "sonner";
import {
  useStarMutation,
  useTrashMutation,
  useRestoreMutation,
} from "@/hooks/mutations/useFileMutations";

interface UseItemActionsProps {
  id: string;
  name: string;
  type: "file" | "folder";
  isStarred: boolean;
  signedUrl?: string | null;
  onRefresh?: () => void;
}

export function useItemActions({ id, name, type, isStarred, signedUrl, onRefresh }: UseItemActionsProps) {
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showTrashDialog, setShowTrashDialog] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const starMutation = useStarMutation();
  const trashMutation = useTrashMutation();
  const restoreMutation = useRestoreMutation();

  const isPending = starMutation.isPending || trashMutation.isPending || restoreMutation.isPending;
  
  const { download, downloading } = useDownload();
  const isDownloading = downloading.has(id);

  const handleStar = () => {
    starMutation.mutate(
      { id, type, starred: isStarred },
      {
        onSuccess: () => {
          toast.success(isStarred ? "Unstarred" : "Starred");
          onRefresh?.();
        },
        onError: () => toast.error("Failed to update star"),
      }
    );
  };

  const handleTrash = () => {
    trashMutation.mutate(
      { id, type },
      {
        onSuccess: () => {
          toast.success("Moved to trash");
          onRefresh?.();
        },
        onError: () => toast.error("Failed to trash item"),
      }
    );
  };

  const handleRestore = () => {
    restoreMutation.mutate(
      { id, type },
      {
        onSuccess: () => {
          toast.success("Restored item");
          onRefresh?.();
        },
        onError: () => toast.error("Failed to restore item"),
      }
    );
  };
  
  const handleMainClick = (onFolderOpen?: (id: string, name: string) => void) => {
    if (type === "file") setShowPreview(true);
    if (type === "folder") onFolderOpen?.(id, name);
  };

  const handleDownload = () => download(id, name, type, signedUrl);

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
