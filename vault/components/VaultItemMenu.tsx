"use client";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  DotsThreeVertical,
  PencilSimple,
  Trash,
  FolderSimple,
  Info,
  DownloadSimple,
  NotePencil,
} from "@phosphor-icons/react";

interface Props {
  type: "file" | "folder";
  id: string;
  name: string;

  onRename: () => void;
  onDelete: () => void;
  onMove: () => void;
  onEdit?: () => void;
  onDetails?: () => void;
  onDownload?: () => void;
}

export default function VaultItemMenu({
  type,
  name,
  onRename,
  onDelete,
  onMove,
  onEdit,
  onDetails,
  onDownload,
}: Props) {
  const isEditable = type === "file" && name.toLowerCase().endsWith(".txt");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
          <DotsThreeVertical size={16} weight="bold" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-40">
        {isEditable && onEdit && (
          <DropdownMenuItem onClick={onEdit}>
            <NotePencil className="mr-2" /> Edit
          </DropdownMenuItem>
        )}

        <DropdownMenuItem onClick={onRename}>
          <PencilSimple className="mr-2" /> Rename
        </DropdownMenuItem>

        <DropdownMenuItem onClick={onMove}>
          <FolderSimple className="mr-2" /> Move to...
        </DropdownMenuItem>

        {onDetails && (
          <DropdownMenuItem onClick={onDetails}>
            <Info className="mr-2" /> Details
          </DropdownMenuItem>
        )}
        
        {onDownload && (
          <DropdownMenuItem onClick={onDownload}>
            <DownloadSimple className="mr-2" /> Download
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={onDelete}
          className="text-red-500 focus:text-red-500 focus:bg-red-500/10 dark:focus:bg-red-500/20"
        >
          <Trash className="mr-2" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}