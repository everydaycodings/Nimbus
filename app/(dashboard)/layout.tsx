import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { ClientLayout } from "./ClientLayout";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function getUser(userId: string) {
  const { data } = await supabase
    .from("users")
    .select("id, storage_used, storage_limit")
    .eq("id", userId)
    .single();
  return data;
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;

  if (!userId) redirect("/auth/login");

  let user = await getUser(userId);

  // Self-heal out-of-sync users (e.g. if the DB trigger was missed during dev)
  if (!user) {
    await supabase.from("users").insert({
      id: userId,
      email: authUserResponse.data.user?.email,
      full_name: authUserResponse.data.user?.user_metadata?.full_name,
      avatar_url: authUserResponse.data.user?.user_metadata?.avatar_url,
    });
    user = await getUser(userId);
  }

  if (!user) {
    throw new Error("Failed to initialize user space.");
  }

  return <ClientLayout user={user}>{children}</ClientLayout>;
}