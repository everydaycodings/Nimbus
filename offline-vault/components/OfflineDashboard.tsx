"use client";

import { useOfflineVault } from "../hooks/useOfflineVault";
import VaultSelector from "./VaultSelector";
import LocalFileExplorer from "./LocalFileExplorer";

export default function OfflineDashboard() {
  const { isUnlocked } = useOfflineVault();

  return (
    <div className="p-4 md:p-6 h-full overflow-y-auto">
      {isUnlocked ? <LocalFileExplorer /> : <VaultSelector />}
    </div>
  );
}
