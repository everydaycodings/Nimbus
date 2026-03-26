"use client";

import { create } from "zustand";

export type UploadItem = {
  id: string;
  name: string;
  progress: number;
  status: "uploading" | "complete" | "error" | "cancelled";
};

type UploadStore = {
  uploads: UploadItem[];
  addUpload: (file: UploadItem) => void;
  updateUpload: (id: string, patch: Partial<UploadItem>) => void;
  removeUpload: (id: string) => void;
};

export const useUploadStore = create<UploadStore>((set) => ({
  uploads: [],

  addUpload: (file) =>
    set((s) => ({ uploads: [...s.uploads, file] })),

  updateUpload: (id, patch) =>
    set((s) => ({
      uploads: s.uploads.map((f) =>
        f.id === id ? { ...f, ...patch } : f
      ),
    })),

  removeUpload: (id) =>
    set((s) => ({
      uploads: s.uploads.filter((f) => f.id !== id),
    })),
}));