"use client";

// Reliable drag-and-drop for file uploads.
//
// Fixes the two recurring problems with the old per-component handlers:
//  1. Flicker — dragenter/dragleave fire for every child element, so a single
//     setIsDragging(false) on dragleave would drop the overlay while still
//     hovering. We track a depth counter instead.
//  2. Folders silently ignored — DataTransfer.files doesn't expose files inside
//     dropped folders. We capture webkitGetAsEntry() synchronously and walk it.

import { useCallback, useRef, useState } from "react";
import { collectDroppedFiles } from "@/lib/upload/collectDroppedFiles";

export function useFileDrop(onFiles: (files: File[]) => void) {
  const [isDragging, setIsDragging] = useState(false);
  const depth = useRef(0);

  const isFileDrag = (e: React.DragEvent) =>
    Array.from(e.dataTransfer?.types ?? []).includes("Files");

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    depth.current += 1;
    setIsDragging(true);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    // Required so the browser allows the drop.
    e.preventDefault();
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setIsDragging(false);
  }, []);

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      depth.current = 0;
      setIsDragging(false);

      const dt = e.dataTransfer;
      // Capture synchronously — the DataTransfer is cleared after this handler.
      const entries = Array.from(dt.items ?? [])
        .map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
        .filter(Boolean);
      const plainFiles = Array.from(dt.files ?? []);

      let files: File[];
      if (entries.length > 0) {
        files = await collectDroppedFiles(entries);
        // Fallback: some browsers expose files but not entries.
        if (files.length === 0) files = plainFiles;
      } else {
        files = plainFiles;
      }

      if (files.length > 0) onFiles(files);
    },
    [onFiles]
  );

  return {
    isDragging,
    dragHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
}
