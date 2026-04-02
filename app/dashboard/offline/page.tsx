// app/dashboard/offline/page.tsx
import { Metadata } from "next";
import OfflineDashboard from "@/offline-vault/components/OfflineDashboard";

export const metadata: Metadata = {
  title: "Offline Vault | Nimbus",
  description: "Secure, local-only storage powered by your browser.",
};

export default function OfflineVaultPage() {
  return (
    <div className="h-full flex flex-col p-4 md:p-8">
       <div className="flex-1 bg-card rounded-3xl border shadow-sm overflow-hidden min-h-[600px]">
          <OfflineDashboard />
       </div>
    </div>
  );
}
