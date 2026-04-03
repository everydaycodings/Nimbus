// app/api/download/init/route.ts
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { getAllFiles } from "@/lib/stream-zip";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function POST(req: Request) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;

  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { folderId } = await req.json();

  if (!folderId) {
    return Response.json({ error: "Missing folderId" }, { status: 400 });
  }

  // ── Permission Check ──
  const { data: folder, error } = await supabase
    .from("folders")
    .select("id, name, owner_id")
    .eq("id", folderId)
    .eq("is_trashed", false)
    .single();

  if (error || !folder) {
    return Response.json({ error: "Folder not found" }, { status: 404 });
  }

  const isOwner = folder.owner_id === userId;
  if (!isOwner) {
    const { data: permission } = await supabase
      .from("permissions")
      .select("id")
      .eq("resource_id", folderId)
      .eq("resource_type", "folder")
      .eq("user_id", userId)
      .single();

    if (!permission) {
      return Response.json({ error: "Access denied" }, { status: 403 });
    }
  }

  // ── Calculate Metadata ──
  const allFiles = await getAllFiles(folderId);
  const downloadId = crypto.randomUUID();

  return Response.json({
    downloadId,
    totalFiles: allFiles.length,
    name: folder.name,
  });
}
