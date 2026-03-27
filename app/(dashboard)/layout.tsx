import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { ClientLayout } from "./ClientLayout";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function getUser(clerkId: string) {
  const { data } = await supabase
    .from("users")
    .select("id, storage_used, storage_limit")
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

  if (!userId) redirect("/auth/login");

  const user = await getUser(userId);

  if (!user) redirect("/onboarding");

  return <ClientLayout user={user}>{children}</ClientLayout>;
}