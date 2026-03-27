"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { Navbar } from "@/components/navbar";
import { UploadToast } from "@/components/UploadToast";

export function ClientLayout({
  children,
  user,
}: {
  children: React.ReactNode;
  user: {
    storage_used: number;
    storage_limit: number;
  };
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        storageUsed={user.storage_used}
        storageLimit={user.storage_limit}
      />

      <div className="flex flex-col flex-1 overflow-hidden">
        <Navbar />

        <main className="flex-1 overflow-y-auto">
          <div
            key={pathname}
            className="animate-in fade-in duration-200"
          >
            {children}
          </div>
        </main>
      </div>

      <UploadToast />
    </div>
  );
}