// app/(dashboard)/layout.tsx
// Only dashboard pages get the sidebar + navbar
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { Sidebar } from "@/components/sidebar";
import { Navbar } from "@/components/navbar";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function getUser(clerkId: string) {
  const { data } = await supabase
    .from("users")
    .select("id, full_name, email, storage_used, storage_limit")
    .eq("clerk_id", clerkId)
    .single();
  return data;
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();

  // Not logged in → send to login
  if (!userId) redirect("/auth/login");

  const user = await getUser(userId);

  // Webhook hasn't fired yet → wait on onboarding screen
  if (!user) redirect("/onboarding");

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        storageUsed={user.storage_used}
        storageLimit={user.storage_limit}
      />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Navbar />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}