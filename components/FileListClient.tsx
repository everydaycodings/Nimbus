// components/FileListClient.tsx
"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus, CloudArrowUp } from "@phosphor-icons/react";
import { FileGrid } from "@/components/FileGrid";
import { useUpload } from "@/hooks/useUpload";
import { cn } from "@/lib/utils";
import { CreateFolderDialog } from "./CreateFolderDialog";
import { ActionsDropdown } from "./UploadDropdown";
import { FileFilters } from "./FileFilters";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useFilesQuery } from "@/hooks/queries/useFilesQuery";

const TEAL = "#2da07a";

export function FileListClient({ initialData }: { initialData?: any }) {
  const router = useRouter();
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string; name: string }[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const searchParams = useSearchParams();

  // Derive query options from URL params
  const query = searchParams.get("query");
  const type = searchParams.get("type");
  const sortBy = searchParams.get("sortBy");
  const sortOrder = searchParams.get("sortOrder");
  const minSize = searchParams.get("minSize") ? Number(searchParams.get("minSize")) : undefined;
  const maxSize = searchParams.get("maxSize") ? Number(searchParams.get("maxSize")) : undefined;
  const page = Number(searchParams.get("page") || 1);
  const tagId = searchParams.get("tagId") || undefined;

  // Parse path/names from URL for breadcrumbs
  const pathParam = searchParams.get("path");
  const namesParam = searchParams.get("names");
  const folderParam = searchParams.get("folder");
  const folderNameParam = searchParams.get("name");

  // Determine the active folder from URL
  const activeFolderId = (() => {
    if (pathParam && namesParam) {
      const ids = pathParam.split(",");
      return ids[ids.length - 1];
    }
    if (folderParam) return folderParam;
    if (query) return null; // search mode
    return null;
  })();

  // Update breadcrumbs when URL changes
  useEffect(() => {
    if (pathParam && namesParam) {
      const ids = pathParam.split(",");
      const decodedNames = namesParam.split(",").map(decodeURIComponent);
      const crumbs = ids.map((id, i) => ({ id, name: decodedNames[i] }));
      setBreadcrumbs(crumbs);
      setCurrentFolder(ids[ids.length - 1]);
    } else if (folderParam) {
      setCurrentFolder(folderParam);
      if (folderNameParam) {
        setBreadcrumbs([{ id: folderParam, name: decodeURIComponent(folderNameParam) }]);
      }
    } else {
      setCurrentFolder(null);
      setBreadcrumbs([]);
    }
  }, [pathParam, namesParam, folderParam, folderNameParam]);

  const queryOptions = {
    page,
    query: query || undefined,
    type: type || undefined,
    sortBy: sortBy || undefined,
    sortOrder: sortOrder || undefined,
    minSize,
    maxSize,
    tagId,
  };

  const { data, refetch: refresh } = useFilesQuery(activeFolderId, queryOptions, initialData);

  const files = (data?.files ?? []) as any[];
  const folders = (query && !tagId) ? [] : ((data?.folders ?? []) as any[]);

  const { uploadMany } = useUpload({
    parentFolderId: currentFolder ?? undefined,
    onSuccess: () => refresh(),
  });

  // ── Drag and drop ─────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      uploadMany(e.dataTransfer.files);
    }
  };

  // ── Folder navigation ─────────────────────────────────────
  const openFolder = (id: string, name: string) => {
    const newPath = [...breadcrumbs, { id, name }];

    const pathIds = newPath.map((c) => c.id).join(",");
    const pathNames = newPath.map((c) => encodeURIComponent(c.name)).join(",");

    router.push(`/dashboard/files?path=${pathIds}&names=${pathNames}`);
  };

  const navigateToBreadcrumb = (index: number) => {
    const newCrumbs = breadcrumbs.slice(0, index + 1);

    const pathIds = newCrumbs.map((c) => c.id).join(",");
    const pathNames = newCrumbs.map((c) => encodeURIComponent(c.name)).join(",");

    router.push(`/dashboard/files?path=${pathIds}&names=${pathNames}`);
  };

  const navigateToRoot = () => {
    router.push("/dashboard/files");
  };

  return (
    <div
      className={cn(
        "flex flex-col h-full p-4 md:p-6 transition-all duration-150",
        isDragging && "bg-[#2da07a]/5 ring-2 ring-inset ring-[#2da07a]/30 rounded-xl"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-6">

        {/* Left: Breadcrumbs */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1 text-sm overflow-x-auto scrollbar-hide whitespace-nowrap">
            <button
              onClick={navigateToRoot}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              My Files
            </button>

            {breadcrumbs.map((crumb, i) => (
              <span key={crumb.id} className="flex items-center gap-1">
                <span className="text-muted-foreground">/</span>

                <button
                  onClick={() => navigateToBreadcrumb(i)}
                  className={cn(
                    "transition-colors",
                    i === breadcrumbs.length - 1
                      ? "text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          <ActionsDropdown
            uploadMany={uploadMany}
            setShowCreateFolder={setShowCreateFolder}
            refresh={refresh}
          />
        </div>
      </div>

      <FileFilters />

      {/* Dialog */}
      {showCreateFolder && (
        <CreateFolderDialog
          parentFolderId={currentFolder}
          onSuccess={refresh}
          onClose={() => setShowCreateFolder(false)}
        />
      )}

      {/* ── Drag overlay hint ── */}
      {isDragging && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-2">
            <CloudArrowUp size={40} style={{ color: "#2da07a" }} weight="duotone" />
            <p className="text-sm font-medium" style={{ color: "#2da07a" }}>Drop files to upload</p>
          </div>
        </div>
      )}

      {/* ── File grid ── */}
      <FileGrid
        files={files}
        folders={folders}
        onFolderOpen={openFolder}
        onRefresh={refresh}
      />
    </div>
  );
}