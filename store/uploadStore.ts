"use client";

import { create } from "zustand";

export type UploadItem = {
  id: string;
  name: string;
  progress: number;
  status: "encrypting" | "uploading" | "complete" | "error" | "cancelled";
  fileId?: string | null;
  source?: "vault" | "drive";
  error?: string;
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
}));