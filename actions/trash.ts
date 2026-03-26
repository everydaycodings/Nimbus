// actions/trash.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { s3, BUCKET } from "@/lib/s3";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function emptyTrash() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("clerk_id", userId)
    .single();

  if (!user) throw new Error("User not found");

  // Get all trashed files (need s3_key to delete from S3)
  const { data: files } = await supabase
    .from("files")
    .select("id, s3_key")
    .eq("owner_id", user.id)
    .eq("is_trashed", true);

  // Delete from S3 first
  if (files && files.length > 0) {
    await Promise.allSettled(
      files.map((file) =>
        s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: file.s3_key }))
      )
    );
  }

  // Delete files from Supabase (storage trigger fires automatically)
  if (files && files.length > 0) {
    await supabase
      .from("files")
      .delete()
      .eq("owner_id", user.id)
      .eq("is_trashed", true);
  }

  // Delete trashed folders
  await supabase
    .from("folders")
    .delete()
    .eq("owner_id", user.id)
    .eq("is_trashed", true);
}