// lib/s3-signer.ts
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, BUCKET } from "./s3";

/**
 * Signs a list of S3 keys in parallel for instant download/preview.
 * @param files A list of file objects containing s3_key, name, and mime_type.
 * @param expiresIn Time in seconds until the URL expires (default 1 hour).
 */
export async function signFiles(
  files: { s3_key: string; name: string; mime_type: string }[],
  expiresIn: number = 3600
) {
  if (!files || files.length === 0) return [];

  const signPromises = files.map(async (file) => {
    try {
      // 1. Signed URL for Preview (inline)
      const previewCommand = new GetObjectCommand({
        Bucket: BUCKET,
        Key: file.s3_key,
        ResponseContentDisposition: `inline; filename="${file.name}"`,
        ResponseContentType: file.mime_type,
        ResponseCacheControl: "public, max-age=31536000, immutable",
      });

      // 2. Signed URL for Download (attachment)
      const downloadCommand = new GetObjectCommand({
        Bucket: BUCKET,
        Key: file.s3_key,
        ResponseContentDisposition: `attachment; filename="${file.name}"`,
        ResponseContentType: file.mime_type,
        ResponseCacheControl: "public, max-age=31536000, immutable",
      });

      const [signedUrl, downloadUrl] = await Promise.all([
        getSignedUrl(s3, previewCommand, { expiresIn }),
        getSignedUrl(s3, downloadCommand, { expiresIn }),
      ]);

      return { ...file, signed_url: signedUrl, download_url: downloadUrl };
    } catch (error) {
      console.error(`[s3-signer] Failed to sign ${file.s3_key}:`, error);
      return { ...file, signed_url: null, download_url: null };
    }
  });

  return Promise.all(signPromises);
}
