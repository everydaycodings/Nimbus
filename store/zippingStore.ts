"use client";

import { create } from "zustand";

export type ZippingItem = {
  id: string;
  name: string;
  progress: number;
  status: "preparing" | "zipping" | "downloading" | "complete" | "error";
  totalFiles: number;
  filesProcessed: number;
  error?: string;
};

type ZippingStore = {
  zippings: ZippingItem[];
  addZipping: (item: ZippingItem) => void;
  updateZipping: (id: string, patch: Partial<ZippingItem>) => void;
  removeZipping: (id: string) => void;
};

export const useZippingStore = create<ZippingStore>((set) => ({
  zippings: [],

  addZipping: (item) =>
    set((state) => ({
      zippings: [...state.zippings, item],
    })),

  updateZipping: (id, patch) =>
    set((state) => ({
      zippings: state.zippings.map((z) =>
        z.id === id ? { ...z, ...patch } : z
      ),
    })),

  removeZipping: (id) =>
    set((state) => ({
      zippings: state.zippings.filter((z) => z.id !== id),
    })),
}));
