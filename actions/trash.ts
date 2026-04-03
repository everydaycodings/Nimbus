// actions/trash.ts
"use server";

import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { s3, BUCKET } from "@/lib/s3";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function emptyTrash() {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("id", userId)
    .single();

  if (!user) throw new Error("User not found");

  // Get all trashed files + versions (need s3_key to delete from S3)
  const [{ data: files }, { data: versions }] = await Promise.all([
    supabase
      .from("files")
      .select("id, s3_key")
      .eq("owner_id", user.id)
      .eq("is_trashed", true),
    supabase
      .from("file_versions")
      .select("id, s3_key")
      .eq("is_trashed", true)
  ]);

  // Combine S3 keys to delete
  const keysToDelete = [
    ...(files || []).map(f => f.s3_key),
    ...(versions || []).map(v => v.s3_key)
  ];

  if (keysToDelete.length > 0) {
    await Promise.allSettled(
      keysToDelete.map(key =>
        s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
      )
    );
  }

  // Delete from Supabase
  if (files && files.length > 0) {
    await supabase
      .from("files")
      .delete()
      .eq("owner_id", user.id)
      .eq("is_trashed", true);
  }

  if (versions && versions.length > 0) {
    await supabase
      .from("file_versions")
      .delete()
      .eq("is_trashed", true);
  }

  // Delete trashed folders
  await supabase
    .from("folders")
    .delete()
    .eq("owner_id", user.id)
    .eq("is_trashed", true);
}