// app/api/upload/complete/route.ts
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fileId } = await req.json();
  if (!fileId) {
    return Response.json({ error: "Missing fileId" }, { status: 400 });
  }

  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("clerk_id", userId)
    .single();

  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  const { data: file, error } = await supabase
    .from("files")
    .update({ upload_status: "complete" })
    .eq("id", fileId)
    .eq("owner_id", user.id)
    .eq("upload_status", "pending")
    .select()
    .single();

  if (error || !file) {
    console.error("[complete] update error:", error);
    return Response.json({ error: "Failed to mark file complete" }, { status: 500 });
  }

  return Response.json({ file });
}