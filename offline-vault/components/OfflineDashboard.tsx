"use client";

import { useOfflineVault } from "../hooks/useOfflineVault";
import VaultSelector from "./VaultSelector";
import LocalFileExplorer from "./LocalFileExplorer";

export default function OfflineDashboard() {
  const { isUnlocked } = useOfflineVault();

  if (!isUnlocked) {
    return (
      <div className="h-full w-full overflow-y-auto bg-background/20">
        <VaultSelector />
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden bg-background/20">
      <LocalFileExplorer />
    </div>
  );
}
