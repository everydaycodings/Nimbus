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
      const command = new GetObjectCommand({
        Bucket: BUCKET,
        Key: file.s3_key,
        // We set inline by default for pre-signed URLs so they can be used for previews.
        // The download header can be overridden on the client using the `download` attribute.
        ResponseContentDisposition: `inline; filename="${file.name}"`,
        ResponseContentType: file.mime_type,
        ResponseCacheControl: "public, max-age=31536000, immutable",
      });

      const signedUrl = await getSignedUrl(s3, command, { expiresIn });
      return { ...file, signed_url: signedUrl };
    } catch (error) {
      console.error(`[s3-signer] Failed to sign ${file.s3_key}:`, error);
      return { ...file, signed_url: null };
    }
  });

  return Promise.all(signPromises);
}
