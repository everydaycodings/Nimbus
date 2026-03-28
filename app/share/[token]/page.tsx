// app/share/[token]/page.tsx
// Public page — handles both file and folder sharing

import { createClient } from "@supabase/supabase-js";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, BUCKET } from "@/lib/s3";
import {
  DownloadSimple, File, MusicNote,
  FolderSimple, FilePdf, Image, FileVideo,
} from "@phosphor-icons/react/dist/ssr";
import { notFound } from "next/navigation";
import Link from "next/link";
import { CloudIcon } from "@phosphor-icons/react";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const TEAL = "#2da07a";

function formatBytes(b: number) {
  if (!b) return "0 KB";
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(1)} GB`;
}

const CloudSvg = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 256 256"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    className="text-white"
  >
    <path d="M160,216H72a56,56,0,0,1-4.47-111.82A72,72,0,0,1,208,120a40,40,0,0,1-48,96Z" />
  </svg>
);

const Logo = () => (
  <Link href="/" className="block">
    <div className="flex items-center gap-2.5 px-4 pt-5 pb-4">
      <div
        className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center"
        style={{ backgroundColor: TEAL }}
      >
        <CloudSvg />
      </div>

      <span className="text-[15px] font-bold tracking-tight text-foreground">
        Nimbus
      </span>
    </div>
  </Link>
);

function FileMimeIcon({ mimeType, size = 32 }: { mimeType: string; size?: number }) {
  if (mimeType.startsWith("image/"))  return <Image    size={size} className="text-purple-400" />;
  if (mimeType.startsWith("video/"))  return <FileVideo size={size} className="text-blue-400"   />;
  if (mimeType.startsWith("audio/"))  return <MusicNote size={size} className="text-pink-400"   />;
  if (mimeType === "application/pdf") return <FilePdf   size={size} className="text-red-400"    />;
  return <File size={size} className="text-muted-foreground" />;
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const { data: link } = await supabase
    .from("share_links")
    .select("id, resource_id, resource_type, role, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (!link) return notFound();

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

  // ══════════════════════════════════════════════════════════════
  // FILE
  // ══════════════════════════════════════════════════════════════
  if (link.resource_type === "file") {
    const { data: file } = await supabase
      .from("files")
      .select("id, name, mime_type, size, s3_key")
      .eq("id", link.resource_id)
      .eq("upload_status", "complete")
      .eq("is_trashed", false)
      .maybeSingle();

    if (!file) return notFound();

    const signedUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: BUCKET, Key: file.s3_key,
        ResponseContentDisposition: `inline; filename="${file.name}"`,
        ResponseContentType: file.mime_type,
      }),
      { expiresIn: 3600 }
    );

    return (
      <div className="flex flex-col h-screen bg-background">
        <header className="flex items-center justify-between px-6 py-3 border-b border-border">
          <Logo />
          <a
            href={signedUrl}
            download={file.name}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium text-white hover:opacity-90"
            style={{ backgroundColor: TEAL }}
          >
            <DownloadSimple size={15} weight="bold" />
            Download
          </a>
        </header>

        <div className="flex-1 flex items-center justify-center p-8 overflow-hidden">
          {file.mime_type.startsWith("image/") && (
            <img src={signedUrl} alt={file.name} className="max-w-full max-h-full object-contain rounded-xl shadow-2xl" />
          )}
          {file.mime_type === "application/pdf" && (
            <iframe src={signedUrl} className="w-full h-full rounded-xl border border-border" title={file.name} />
          )}
          {file.mime_type.startsWith("video/") && (
            <video src={signedUrl} controls className="max-w-full max-h-full rounded-xl shadow-2xl" />
          )}
          {file.mime_type.startsWith("audio/") && (
            <div className="flex flex-col items-center gap-6">
              <MusicNote size={80} className="text-pink-400/60" />
              <p className="text-sm font-medium text-foreground">{file.name}</p>
              <audio src={signedUrl} controls className="w-80" />
            </div>
          )}
          {!["image/", "video/", "audio/"].some((t) => file.mime_type.startsWith(t)) &&
            file.mime_type !== "application/pdf" && (
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="w-24 h-24 rounded-2xl flex items-center justify-center border border-border bg-card">
                  <File size={48} className="text-muted-foreground/40" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{file.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">{formatBytes(file.size)}</p>
                </div>
                <a
                  href={signedUrl}
                  download={file.name}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white hover:opacity-90"
                  style={{ backgroundColor: TEAL }}
                >
                  <DownloadSimple size={16} weight="bold" />
                  Download file
                </a>
              </div>
            )}
        </div>

        <footer className="px-6 py-3 border-t border-border text-center">
          <p className="text-xs text-muted-foreground">
            Shared via Nimbus · {link.role === "viewer" ? "View only" : "Can edit"}
          </p>
        </footer>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // FOLDER — grid view
  // ══════════════════════════════════════════════════════════════
  if (link.resource_type === "folder") {
    const { data: folder } = await supabase
      .from("folders")
      .select("id, name")
      .eq("id", link.resource_id)
      .eq("is_trashed", false)
      .maybeSingle();

    if (!folder) return notFound();

    const [{ data: subFolders }, { data: rootFiles }] = await Promise.all([
      supabase
        .from("folders")
        .select("id, name, created_at")
        .eq("parent_folder_id", folder.id)
        .eq("is_trashed", false)
        .order("name"),
      supabase
        .from("files")
        .select("id, name, mime_type, size, s3_key, created_at")
        .eq("parent_folder_id", folder.id)
        .eq("is_trashed", false)
        .eq("upload_status", "complete")
        .order("name"),
    ]);

    // Generate signed download URLs for root files
    const filesWithUrls = await Promise.all(
      (rootFiles ?? []).map(async (f) => {
        const url = await getSignedUrl(
          s3,
          new GetObjectCommand({
            Bucket: BUCKET,
            Key:    f.s3_key,
            ResponseContentDisposition: `attachment; filename="${f.name}"`,
          }),
          { expiresIn: 3600 }
        );
        return { ...f, signedUrl: url };
      })
    );

    const folderCount = (subFolders ?? []).length;
    const fileCount   = filesWithUrls.length;
    const isEmpty     = folderCount === 0 && fileCount === 0;

    return (
      <div className="flex flex-col min-h-screen bg-background">
        {/* Header */}
        <header className="sticky top-0 z-10 flex items-center justify-between px-6 py-3 border-b border-border bg-background/80 backdrop-blur-sm">
          <Logo />
          <span className="text-xs text-muted-foreground border border-border rounded-full px-2 py-0.5">
            {link.role === "viewer" ? "View only" : "Can edit"}
          </span>
        </header>

        <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-8">
          {/* Folder hero */}
          <div className="flex items-center gap-4 mb-8">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: `${TEAL}18` }}
            >
              <FolderSimple size={32} weight="fill" style={{ color: TEAL }} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">{folder.name}</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {isEmpty
                  ? "Empty folder"
                  : [
                      folderCount > 0 && `${folderCount} folder${folderCount !== 1 ? "s" : ""}`,
                      fileCount   > 0 && `${fileCount} file${fileCount !== 1 ? "s" : ""}`,
                    ]
                    .filter(Boolean)
                    .join(" · ")}
              </p>
            </div>
          </div>

          {isEmpty ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <FolderSimple size={48} weight="duotone" className="text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">This folder is empty</p>
            </div>
          ) : (
            <>
              {/* ── Folders grid ── */}
              {folderCount > 0 && (
                <section className="mb-8">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                    Folders
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                    {(subFolders ?? []).map((sub) => (
                      <div
                        key={sub.id}
                        className="flex flex-col rounded-2xl border border-border bg-card overflow-hidden"
                      >
                        {/* Thumbnail */}
                        <div
                          className="flex items-center justify-center"
                          style={{ height: 96, background: `${TEAL}0d` }}
                        >
                          <FolderSimple size={44} weight="fill" style={{ color: TEAL }} />
                        </div>
                        {/* Footer */}
                        <div className="px-3 py-2.5">
                          <p className="text-xs font-medium text-foreground truncate">{sub.name}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {new Date(sub.created_at).toLocaleDateString("en-US", {
                              month: "short", day: "numeric",
                            })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* ── Files grid ── */}
              {fileCount > 0 && (
                <section>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                    Files
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                    {filesWithUrls.map((file) => {
                      const isImage = file.mime_type.startsWith("image/");

                      return (
                        <div
                          key={file.id}
                          className="group flex flex-col rounded-2xl border border-border bg-card overflow-hidden hover:border-[#2da07a]/30 hover:shadow-md transition-all cursor-pointer"
                        >
                          {/* Thumbnail */}
                          <div
                            className="relative flex items-center justify-center overflow-hidden"
                            style={{ height: 96, background: "var(--secondary)" }}
                          >
                            {isImage ? (
                              // Image preview directly from signed URL
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={file.signedUrl}
                                alt={file.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <FileMimeIcon mimeType={file.mime_type} size={36} />
                            )}

                            {/* Download overlay on hover */}
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <a
                                href={file.signedUrl}
                                download={file.name}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-white"
                                style={{ backgroundColor: TEAL }}
                                
                              >
                                <DownloadSimple size={13} weight="bold" />
                                Download
                              </a>
                            </div>
                          </div>

                          {/* Footer */}
                          <div className="px-3 py-2.5">
                            <p className="text-xs font-medium text-foreground truncate">{file.name}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {formatBytes(file.size)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </>
          )}
        </main>

        <footer className="px-6 py-4 border-t border-border text-center">
          <p className="text-xs text-muted-foreground">Shared via Nimbus</p>
        </footer>
      </div>
    );
  }

  return notFound();
}