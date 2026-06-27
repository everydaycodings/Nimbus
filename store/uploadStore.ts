"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type UploadItem = {
  id: string;
  name: string;
  progress: number;
  status: "encrypting" | "uploading" | "complete" | "error" | "cancelled";
  fileId?: string | null;
  source?: "vault" | "drive";
  error?: string;
  // Set during upload; used by retry/resume and richer progress reporting.
  size?: number;
  bytesUploaded?: number;
  parentFolderId?: string | null;
  retryCount?: number;
  kind?: "file" | "multipart";
};

type UploadStore = {
  uploads: UploadItem[];
  addUpload: (file: UploadItem) => void;
  updateUpload: (id: string, patch: Partial<UploadItem>) => void;
  removeUpload: (id: string) => void;
};

export const useUploadStore = create<UploadStore>()(
  persist(
    (set) => ({
      uploads: [],

      addUpload: (file) =>
        set((state) => ({
          uploads: [...state.uploads, file],
        })),

      updateUpload: (id, patch) =>
        set((state) => ({
          uploads: state.uploads.map((f) =>
            f.id === id ? { ...f, ...patch } : f
          ),
        })),

      removeUpload: (id) =>
        set((state) => ({
          uploads: state.uploads.filter((f) => f.id !== id),
        })),
    }),
    {
      name: "nimbus-uploads",
      storage: createJSONStorage(() => sessionStorage),
      // Only persist items that matter across a reload — drop terminal ones so
      // completed/cancelled uploads don't pile up in sessionStorage.
      partialize: (state) => ({
        uploads: state.uploads.filter(
          (u) => u.status === "uploading" || u.status === "encrypting"
        ),
      }),
      // On reload the underlying XHR is gone, so any upload still marked as
      // in-flight can never finish. Mark it as a retryable error instead of
      // leaving a frozen progress bar. (True resume arrives in Phase 2.)
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.uploads = state.uploads.map((u) =>
          u.status === "uploading" || u.status === "encrypting"
            ? { ...u, status: "error", error: "Upload interrupted — please retry" }
            : u
        );
      },
    }
  )
);