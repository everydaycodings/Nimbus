// app/api/upload/complete/route.ts
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { finalizeUpload } from "@/lib/upload/finalizeUpload";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function POST(req: Request) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const userId = authUserResponse.data.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fileId, originalFileId, thumbnailKey } = await req.json();
  if (!fileId) {
    return Response.json({ error: "Missing fileId" }, { status: 400 });
  }

  const result = await finalizeUpload({
    supabase,
    userId,
    fileId,
    originalFileId,
    thumbnailKey,
  });

  return Response.json(result.body, { status: result.status });
}
