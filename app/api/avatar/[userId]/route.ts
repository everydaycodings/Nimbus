// app/api/avatar/[userId]/route.ts
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, BUCKET } from "@/lib/s3";
import { NextResponse } from "next/server";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;
  const url = new URL(req.url);
  const ext = url.searchParams.get("ext") || "jpg";

  const s3Key = `avatars/${userId}.${ext}`;

  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET,
      Key: s3Key,
    });

    // 1-hour expiration. This URL is returned via 302 redirect.
    // The browser caches the redirect URL if we add Cache-Control.
    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
    
    // Redirect browser directly to S3 URL
    return NextResponse.redirect(presignedUrl, {
      status: 302,
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
      },
    });
  } catch (error) {
    console.error("Avatar fetch error:", error);
    return new NextResponse("Not Found", { status: 404 });
  }
}
