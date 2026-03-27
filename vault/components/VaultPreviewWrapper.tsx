"use client";

import { useEffect } from "react";
import { X, DownloadSimple, MusicNote, File, LockKey } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import {
    VideoPlayer,
    AudioPlayer,
    ImageViewer
} from "@/components/FilePreviewDialog";
// ✅ shadcn skeleton
import { Skeleton } from "@/components/ui/skeleton";

const TEAL = "#2da07a";

interface Props {
    objectUrl: string | null; // null while decrypting
    fileName: string;
    mimeType: string;
    isLoading: boolean;
    onClose: () => void;
    onDownload: () => void;
}

export function VaultPreviewWrapper({
    objectUrl,
    fileName,
    mimeType,
    isLoading,
    onClose,
    onDownload,
}: Props) {
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onClose]);

    const isImage = mimeType.startsWith("image/");
    const isPdf = mimeType === "application/pdf";
    const isVideo = mimeType.startsWith("video/");
    const isAudio = mimeType.startsWith("audio/");

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-md">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 bg-background/80 backdrop-blur-sm border-b border-border">
                <div className="flex items-center gap-3 min-w-0">
                    <span
                        className="px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase text-white"
                        style={{ backgroundColor: TEAL }}
                    >
                        {fileName.split(".").pop()}
                    </span>

                    <p className="text-sm font-medium truncate">{fileName}</p>

                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border border-border text-muted-foreground">
                        <LockKey size={10} />
                        Encrypted
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={onDownload}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium text-white"
                        style={{ backgroundColor: TEAL }}
                    >
                        <DownloadSimple size={15} />
                        Download
                    </button>

                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-xl hover:bg-accent"
                    >
                        <X size={18} />
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 flex items-center justify-center p-6">

                {/* 🔥 LOADING STATE */}
                {isLoading && (
                    <div className="flex flex-col items-center gap-4">
                        <Skeleton className="w-[300px] h-[200px] rounded-xl" />
                        <p className="text-sm text-muted-foreground animate-pulse">
                            Decrypting file...
                        </p>
                    </div>
                )}

                {/* ✅ ACTUAL CONTENT */}
                {!isLoading && objectUrl && (
                    <>
                        {isImage && (
                            <ImageViewer src={objectUrl} fileName={fileName} />
                        )}

                        {isPdf && (
                            <iframe
                                src={objectUrl}
                                className="w-full h-full rounded-xl bg-white"
                            />
                        )}

                        {isVideo && (
                            <VideoPlayer src={objectUrl} fileName={fileName} />
                        )}

                        {isAudio && (
                            <AudioPlayer src={objectUrl} fileName={fileName} />
                        )}

                        {!isImage && !isPdf && !isVideo && !isAudio && (
                            <div className="flex flex-col items-center gap-4">
                                <File size={48} className="text-muted-foreground/50" />
                                <p>No preview available</p>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}