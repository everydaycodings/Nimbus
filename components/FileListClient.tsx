// components/FileListClient.tsx
"use client";

import { useState, useCallback, type ComponentProps } from "react";
import { CloudArrowUp } from "@phosphor-icons/react";
import { FileGrid } from "@/components/FileGrid";
import { useUpload } from "@/hooks/useUpload";
import { cn } from "@/lib/utils";
import { CreateFolderDialog } from "./CreateFolderDialog";
import { ActionsDropdown } from "./UploadDropdown";
import { FileFilters } from "./FileFilters";
import { NoteEditorDialog } from "./NoteEditorDialog";
import { useSearchParams } from "next/navigation";
import { useInfiniteFilesQuery } from "@/hooks/queries/useInfiniteFilesQuery";
import { DuplicateUploadDialog } from "./DuplicateUploadDialog";
import { checkFilesExist } from "@/actions/files";
import { InfiniteScrollTrigger } from "@/components/InfiniteScrollTrigger";
import { useFolderPath } from "@/hooks/useFolderPath";
import { useFileDrop } from "@/hooks/useFileDrop";
import { FolderBreadcrumbs } from "@/components/FolderBreadcrumbs";
import { FileGridSkeleton, FolderLoadError } from "@/components/FileGridStates";

type FileGridProps = ComponentProps<typeof FileGrid>;
type FileItem = FileGridProps["files"][number] & { onEdit?: () => void };
type FolderItem = FileGridProps["folders"][number];
type FilesData = {
  files?: FileItem[];
  folders?: FolderItem[];
  pagination?: {
    page: number;
    pageSize: number;
    totalFiles: number;
    totalPages: number;
  };
};

export function FileListClient({ initialData }: { initialData?: unknown }) {
  const {
    breadcrumbs,
    currentFolderId,
    openFolder,
    navigateToBreadcrumb,
    navigateToRoot,
  } = useFolderPath();

  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [noteEditor, setNoteEditor] = useState<{
    open: boolean;
    id?: string;
    name?: string;
    content?: string;
  }>({ open: false });
  const [duplicateCheck, setDuplicateCheck] = useState<{
    open: boolean;
    duplicates: { file: File; existingId: string }[];
    allFiles: File[];
  }>({ open: false, duplicates: [], allFiles: [] });
  const searchParams = useSearchParams();

  // Derive query options from URL params
  const query = searchParams.get("query");
  const type = searchParams.get("type");
  const sortBy = searchParams.get("sortBy");
  const sortOrder = searchParams.get("sortOrder");
  const minSize = searchParams.get("minSize") ? Number(searchParams.get("minSize")) : undefined;
  const maxSize = searchParams.get("maxSize") ? Number(searchParams.get("maxSize")) : undefined;
  const tagId = searchParams.get("tagId") || undefined;

  // In search mode the query results render at the root (no active folder).
  const activeFolderId = query ? null : currentFolderId;

  const queryOptions = {
    query: query || undefined,
    type: type || undefined,
    sortBy: sortBy || undefined,
    sortOrder: sortOrder || undefined,
    minSize,
    maxSize,
    tagId,
  };

  const {
    data,
    refetch: refresh,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isError,
    isLoading,
    isFetching,
    isPlaceholderData,
  } = useInfiniteFilesQuery(activeFolderId, queryOptions, initialData);

  // First-load skeleton vs. dimmed-while-switching: isLoading covers the very
  // first fetch; isPlaceholderData means we're showing the previous folder
  // while the next one loads.
  const showSkeleton = isLoading && !data;
  const isSwitching = isFetching && isPlaceholderData;

  const pages = (data?.pages ?? []) as FilesData[];
  const files = pages.flatMap((page) => page.files ?? []);
  const folders = (query && !tagId) ? [] : (pages[0]?.folders ?? []);

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const { upload, uploadMany } = useUpload({
    parentFolderId: activeFolderId ?? undefined,
  });

  const handleUploadFiles = useCallback(async (incomingFiles: FileList | File[]) => {
    const fileList = Array.from(incomingFiles);
    const names = fileList.map(f => f.name);

    try {
      const existingFiles = await checkFilesExist(activeFolderId, names);
      const duplicates: { file: File; existingId: string }[] = [];

      existingFiles.forEach(existing => {
        const file = fileList.find(f => f.name === existing.name);
        if (file) {
          duplicates.push({ file, existingId: existing.id });
        }
      });

      if (duplicates.length > 0) {
        setDuplicateCheck({ open: true, duplicates, allFiles: fileList });
      } else {
        uploadMany(fileList);
      }
    } catch (err) {
      console.error("Duplicate check failed", err);
      uploadMany(fileList); // fall back to normal upload
    }
  }, [activeFolderId, uploadMany]);

  const handleProcessDuplicates = (action: "upload" | "skip") => {
    if (action === "upload") {
      // Upload all files. For duplicates, pass existingId for versioning.
      duplicateCheck.allFiles.forEach(file => {
        const dup = duplicateCheck.duplicates.find(d => d.file.name === file.name);
        upload(file, dup?.existingId);
      });
    } else if (action === "skip") {
      // Upload only non-duplicates
      const nonDuplicates = duplicateCheck.allFiles.filter(
        f => !duplicateCheck.duplicates.some(d => d.file.name === f.name)
      );
      if (nonDuplicates.length > 0) {
        uploadMany(nonDuplicates);
      }
    }
    setDuplicateCheck({ open: false, duplicates: [], allFiles: [] });
  };

  // ── Drag and drop (reliable: depth-counted, folder-aware) ──
  const { isDragging, dragHandlers } = useFileDrop(handleUploadFiles);

  // ── Note Editing ──────────────────────────────────────────
  const handleEditNote = async (file: FileItem) => {
    try {
      // If we have a signedUrl, we can fetch the content
      let content = "";
      const fileUrl = file.signed_url ?? file.download_url;
      if (fileUrl) {
        const res = await fetch(fileUrl);
        if (res.ok) content = await res.text();
      }
      setNoteEditor({
        open: true,
        id: file.id,
        name: file.name,
        content: content,
      });
    } catch (err) {
      console.error("Failed to fetch note content", err);
    }
  };

  const enhancedFiles = files.map((f) => ({
    ...f,
    onEdit: () => handleEditNote(f),
  }));

  return (
    <div
      className={cn(
        "relative flex h-full flex-col p-4 transition-all duration-150 md:p-6",
        isDragging && "bg-[#2da07a]/5 ring-2 ring-inset ring-[#2da07a]/30 rounded-xl"
      )}
      {...dragHandlers}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-6">

        {/* Left: Breadcrumbs */}
        <div className="flex flex-col gap-1">
          <FolderBreadcrumbs
            breadcrumbs={breadcrumbs}
            rootLabel="My Files"
            onRoot={navigateToRoot}
            onCrumb={navigateToBreadcrumb}
          />
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          <ActionsDropdown
            onUpload={handleUploadFiles}
            setShowCreateFolder={setShowCreateFolder}
            refresh={refresh}
            parentFolderId={activeFolderId}
            onNewNote={() => setNoteEditor({ open: true })}
          />
        </div>
      </div>

      <FileFilters />

      {/* Dialogs */}
      {duplicateCheck.open && (
        <DuplicateUploadDialog
          isOpen={duplicateCheck.open}
          duplicates={duplicateCheck.duplicates.map(d => ({ name: d.file.name }))}
          onClose={() => setDuplicateCheck({ open: false, duplicates: [], allFiles: [] })}
          onUpload={() => handleProcessDuplicates("upload")}
          onSkip={() => handleProcessDuplicates("skip")}
        />
      )}

      {showCreateFolder && (
        <CreateFolderDialog
          parentFolderId={activeFolderId}
          onSuccess={refresh}
          onClose={() => setShowCreateFolder(false)}
        />
      )}

      {noteEditor.open && (
        <NoteEditorDialog
          id={noteEditor.id}
          name={noteEditor.name}
          initialContent={noteEditor.content}
          parentFolderId={activeFolderId}
          onSuccess={refresh}
          onClose={() => setNoteEditor({ open: false })}
        />
      )}

      {/* ── Drag overlay hint ── */}
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <CloudArrowUp size={40} style={{ color: "#2da07a" }} weight="duotone" />
            <p className="text-sm font-medium" style={{ color: "#2da07a" }}>Drop files to upload</p>
          </div>
        </div>
      )}

      {/* ── File grid ── */}
      {showSkeleton ? (
        <FileGridSkeleton />
      ) : isError ? (
        <FolderLoadError onRetry={() => refresh()} />
      ) : (
        <>
          <div className={cn("transition-opacity", isSwitching && "opacity-50 pointer-events-none")}>
            <FileGrid
              files={enhancedFiles}
              folders={folders}
              onFolderOpen={openFolder}
              onRefresh={refresh}
            />
          </div>

          <InfiniteScrollTrigger
            hasMore={!!hasNextPage}
            isLoading={isFetchingNextPage}
            onLoadMore={loadMore}
          />
        </>
      )}
    </div>
  );
}
