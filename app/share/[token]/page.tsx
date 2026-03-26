// app/share/[token]/page.tsx
// Public page — anyone with the link lands here
import { createClient } from "@supabase/supabase-js";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, BUCKET } from "@/lib/s3";
import { DownloadSimple, File, FilePdf, Image, FileVideo, MusicNote } from "@phosphor-icons/react/dist/ssr";
import { notFound } from "next/navigation";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export default async function SharePage({
  params,
}: {
  params: { token: string };
}) {
  const { data: link } = await supabase
    .from("share_links")
    .select("id, resource_id, resource_type, role, expires_at")
    .eq("token", params.token)
    .single();

  if (!link) notFound();

  const expired = link.expires_at && new Date(link.expires_at) < new Date();

  if (expired) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-lg font-semibold text-foreground">Link expired</p>
          <p className="text-sm text-muted-foreground mt-1">Ask the owner for a new link.</p>
        </div>
      </div>
    );
  }

  if (link.resource_type !== "file") {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-lg font-semibold text-foreground">Folder sharing coming soon</p>
        </div>
      </div>
    );
  }

  const { data: file } = await supabase
    .from("files")
    .select("id, name, mime_type, size, s3_key")
    .eq("id", link.resource_id)
    .eq("upload_status", "complete")
    .eq("is_trashed", false)
    .single();

  if (!file) notFound();

  // Generate a signed URL for the file
  const command = new GetObjectCommand({
    Bucket:                     BUCKET,
    Key:                        file.s3_key,
    ResponseContentDisposition: `inline; filename="${file.name}"`,
    ResponseContentType:        file.mime_type,
  });
  const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

  const formatBytes = (b: number) => {
    if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
    return `${(b / 1024 ** 3).toFixed(1)} GB`;
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-border bg-background">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: "#2da07a" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
              <path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-foreground">Nimbus</span>
        </div>
        <a
          href={signedUrl}
          download={file.name}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium text-white transition-all hover:opacity-90"
          style={{ backgroundColor: "#2da07a" }}
        >
          <DownloadSimple size={15} weight="bold" />
          Download
        </a>
      </header>

      {/* Preview */}
      <div className="flex-1 flex items-center justify-center p-8 overflow-hidden">
        {file.mime_type.startsWith("image/") && (
          <img
            src={signedUrl}
            alt={file.name}
            className="max-w-full max-h-full object-contain rounded-xl shadow-2xl"
          />
        )}
        {file.mime_type === "application/pdf" && (
          <iframe
            src={signedUrl}
            className="w-full h-full rounded-xl border border-border"
            title={file.name}
          />
        )}
        {file.mime_type.startsWith("video/") && (
          <video src={signedUrl} controls className="max-w-full max-h-full rounded-xl shadow-2xl" />
        )}
        {file.mime_type.startsWith("audio/") && (
          <div className="flex flex-col items-center gap-6">
            <MusicNote size={80} weight="duotone" className="text-pink-400/60" />
            <p className="text-sm font-medium text-foreground">{file.name}</p>
            <audio src={signedUrl} controls className="w-80" />
          </div>
        )}
        {!file.mime_type.startsWith("image/") &&
         !file.mime_type.startsWith("video/") &&
         !file.mime_type.startsWith("audio/") &&
         file.mime_type !== "application/pdf" && (
          <div className="flex flex-col items-center gap-4 text-center">
            <File size={64} weight="duotone" className="text-muted-foreground/40" />
            <div>
              <p className="text-sm font-semibold text-foreground">{file.name}</p>
              <p className="text-xs text-muted-foreground mt-1">{formatBytes(file.size)}</p>
            </div>
            <a
              href={signedUrl}
              download={file.name}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white hover:opacity-90 transition-all"
              style={{ backgroundColor: "#2da07a" }}
            >
              <DownloadSimple size={16} weight="bold" />
              Download file
            </a>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="px-6 py-3 border-t border-border text-center">
        <p className="text-xs text-muted-foreground">
          Shared via Nimbus · {link.role === "viewer" ? "View only" : "Can edit"}
        </p>
      </footer>
    </div>
  );
}