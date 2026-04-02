"use client";

import { useRef } from "react";
import {
    FolderPlus,
    CloudArrowUp,
    FolderSimple,
    DotsThreeVertical,
    PlusIcon,
    CaretDown,
} from "@phosphor-icons/react";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { VAULT_MAX_FILE_SIZE_LABEL } from "../lib/crypto";

const TEAL = "#2da07a";

interface Props {
    uploadMany: (files: FileList | File[]) => void;
    uploadFolder: (files: FileList) => void;
    setShowCreateFolder: (v: boolean) => void;
    isFragmented?: boolean;
}

export default function VaultUploadDropdown({
    uploadMany,
    uploadFolder,
    setShowCreateFolder,
    isFragmented = false,
}: Props) {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const folderInputRef = useRef<HTMLInputElement | null>(null);

    return (
        <>
            {/* Hidden Inputs */}
            <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && uploadMany(e.target.files)}
            />

            <input
                ref={folderInputRef}
                type="file"
                multiple
                // @ts-ignore
                webkitdirectory=""
                className="hidden"
                onChange={(e) => e.target.files && uploadFolder(e.target.files)}
            />

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button
                        className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium 
        bg-secondary border border-border text-secondary-foreground 
        hover:bg-accent hover:text-accent-foreground 
        transition-all shadow-sm hover:shadow"
                    >
                        <PlusIcon size={16} weight="bold" style={{ color: TEAL }} />
                        New
                        <CaretDown size={14} className="opacity-60" />
                    </button>
                </DropdownMenuTrigger>

                <DropdownMenuContent align="start" className="w-56">
                    {/* New Folder */}
                    <DropdownMenuItem onClick={() => setShowCreateFolder(true)}>
                        <FolderPlus size={15} style={{ color: TEAL }} />
                        <span>New folder</span>
                    </DropdownMenuItem>

                    {/* Upload Files */}
                    <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                        <CloudArrowUp size={15} style={{ color: TEAL }} />
                        <div className="flex flex-col">
                            <span>Upload files</span>
                            <span className="text-[10px] text-muted-foreground">
                                max {isFragmented ? "50 MB" : VAULT_MAX_FILE_SIZE_LABEL}
                            </span>
                        </div>
                    </DropdownMenuItem>

                    {/* Upload Folder */}
                    <DropdownMenuItem onClick={() => folderInputRef.current?.click()}>
                        <FolderSimple size={15} style={{ color: TEAL }} />
                        <span>Upload folder</span>
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </>
    );
}