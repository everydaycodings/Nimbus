// app/api/search/route.ts
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function GET(req: Request) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q")?.trim();

  if (!query || query.length < 2) {
    return Response.json({ files: [], folders: [] });
  }

  // Get internal user id
  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("id", userId)
    .single();

  if (!user) return Response.json({ error: "User not found" }, { status: 404 });

  // Search files and folders in parallel using ilike (case-insensitive)
  const [{ data: files }, { data: folders }] = await Promise.all([
    supabase
      .from("files")
      .select("id, name, mime_type, size, created_at, is_starred, s3_key")
      .eq("owner_id", user.id)
      .eq("is_trashed", false)
      .eq("upload_status", "complete")
      .ilike("name", `%${query}%`)
      .order("created_at", { ascending: false })
      .limit(10),

    supabase
      .from("folders")
      .select("id, name, created_at, is_starred")
      .eq("owner_id", user.id)
      .eq("is_trashed", false)
      .ilike("name", `%${query}%`)
      .order("name")
      .limit(5),
  ]);

  return Response.json({
    files:   files   ?? [],
    folders: folders ?? [],
  });
}