// app/api/user/avatar/route.ts
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, BUCKET } from "@/lib/s3";

export async function POST(req: Request) {
  const supabaseServer = await createSupabaseClient();
  const { data: { user }, error: authError } = await supabaseServer.auth.getUser();
  
  if (authError || !user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { mimeType } = await req.json();

  if (!mimeType || !mimeType.startsWith('image/')) {
    return Response.json({ error: "Invalid image format" }, { status: 400 });
  }

  const ext = mimeType.split("/").pop();
  // Using user.id without a timestamp so it nicely overwrites in S3 naturally, saving storage.
  const s3Key = `avatars/${user.id}.${ext}`;

  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: s3Key,
      ContentType: mimeType,
    });

    // Short expiration for the upload link
    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 60 });
    
    // The final display URL will route through our secure proxy
    const avatarUrl = `/api/avatar/${user.id}?ext=${ext}&v=${Date.now()}`;

    return Response.json({ presignedUrl, s3Key, avatarUrl });
  } catch (err: any) {
    console.error("Avatar upload presign error:", err);
    return Response.json({ error: "Failed to generate upload URL" }, { status: 500 });
  }
}
