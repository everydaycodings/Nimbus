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
} from "@phosphor-icons/react";

interface Props {
  type: "file" | "folder";
  id: string;
  name: string;

  onRename: () => void;
  onDelete: () => void;
  onMove: () => void;
}

export default function VaultItemMenu({
  onRename,
  onDelete,
  onMove,
}: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
          <DotsThreeVertical size={16} weight="bold" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={onRename}>
          <PencilSimple className="mr-2" /> Rename
        </DropdownMenuItem>

        <DropdownMenuItem onClick={onMove}>
          <FolderSimple className="mr-2" /> Move to...
        </DropdownMenuItem>

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