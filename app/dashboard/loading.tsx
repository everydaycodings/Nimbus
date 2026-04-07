"use client";

import { Spinner } from "@phosphor-icons/react";

export default function DashboardLoading() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center min-h-[60vh] text-muted-foreground w-full h-full gap-3 animate-in fade-in duration-300">
      <Spinner size={32} className="animate-spin text-[#2da07a]" weight="bold" />
      <p className="text-sm font-medium">Loading...</p>
    </div>
  );
}
