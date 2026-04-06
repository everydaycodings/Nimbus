// lib/s3-signer.ts
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, BUCKET } from "./s3";

/**
 * Formats a Content-Disposition header with RFC 6266 compliance for non-ASCII filenames.
 */
export function getEncodedContentDisposition(filename: string, mode: "inline" | "attachment") {
  // Simple ASCII fallback (remove non-ASCII)
  const asciiName = filename.replace(/[^\x00-\x7F]/g, "_");
  // RFC 6266 / RFC 5987 encoding
  const encodedName = encodeURIComponent(filename).replace(/['()]/g, escape).replace(/\*/g, "%2a");
  return `${mode}; filename="${asciiName.replace(/"/g, '\\"')}"; filename*=UTF-8''${encodedName}`;
}

/**
 * Signs a list of S3 keys in parallel for instant download/preview.
 * @param files A list of file objects containing s3_key, name, mime_type, and optional thumbnail_key.
 * @param expiresIn Time in seconds until the URL expires (default 1 hour).
 */
export async function signFiles(
  files: { s3_key: string; name: string; mime_type: string; thumbnail_key?: string | null }[],
  expiresIn: number = 3600
) {
  if (!files || files.length === 0) return [];

  const signPromises = files.map(async (file) => {
    try {
      // 1. Signed URL for Preview (inline)
      const previewCommand = new GetObjectCommand({
        Bucket: BUCKET,
        Key: file.s3_key,
        ResponseContentDisposition: getEncodedContentDisposition(file.name, "inline"),
        ResponseContentType: file.mime_type,
        ResponseCacheControl: "public, max-age=31536000, immutable",
      });

      // 2. Signed URL for Download (attachment)
      const downloadCommand = new GetObjectCommand({
        Bucket: BUCKET,
        Key: file.s3_key,
        ResponseContentDisposition: getEncodedContentDisposition(file.name, "attachment"),
        ResponseContentType: file.mime_type,
        ResponseCacheControl: "public, max-age=31536000, immutable",
      });

      const promises: any[] = [
        getSignedUrl(s3, previewCommand, { expiresIn }),
        getSignedUrl(s3, downloadCommand, { expiresIn }),
      ];

      // 3. Optional: Signed URL for Thumbnail
      if (file.thumbnail_key) {
        const thumbCommand = new GetObjectCommand({
          Bucket: BUCKET,
          Key: file.thumbnail_key,
          ResponseContentType: "image/webp",
          ResponseCacheControl: "public, max-age=31536000, immutable",
        });
        promises.push(getSignedUrl(s3, thumbCommand, { expiresIn }));
      }

      const results = await Promise.all(promises);
      const signedUrl = results[0];
      const downloadUrl = results[1];
      const thumbnailUrl = file.thumbnail_key ? results[2] : null;

      return { 
        ...file, 
        signed_url: signedUrl, 
        download_url: downloadUrl,
        thumbnail_url: thumbnailUrl
      };
    } catch (error) {
      console.error(`[s3-signer] Failed to sign ${file.s3_key}:`, error);
      return { 
        ...file, 
        signed_url: null, 
        download_url: null,
        thumbnail_url: null
      };
    }
  });

  return Promise.all(signPromises);
}
