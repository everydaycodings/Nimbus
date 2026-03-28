"use client";

import { useState } from "react";

export type Layout = "list" | "grid";

export function useLayout(storageKey: string = "nimbus-layout") {
  const [layout, setLayout] = useState<Layout>(
    () => typeof window !== "undefined"
      ? (localStorage.getItem(storageKey) as Layout) ?? "grid"
      : "grid"
  );

  const handleLayoutChange = (l: Layout) => {
    setLayout(l);
    localStorage.setItem(storageKey, l);
  };

  return { layout, handleLayoutChange };
}
