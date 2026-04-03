// lib/stream-zip.ts
import archiver from "archiver";
import { PassThrough } from "stream";
import { s3, BUCKET } from "@/lib/s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export interface FileEntry {
  name: string;
  s3_key: string;
  path: string;
}

/**
 * Recursively fetch all files in a folder and its subfolders.
 * Minimal queries: 1 query for all files in the hierarchy if possible, 
 * but standard parent_id recursion is safer for deep trees without complex CTEs.
 */
export async function getAllFiles(folderId: string, path = ""): Promise<FileEntry[]> {
  const [{ data: files }, { data: folders }] = await Promise.all([
    supabase
      .from("files")
      .select("name, s3_key")
      .eq("parent_folder_id", folderId)
      .eq("upload_status", "complete")
      .eq("is_trashed", false),
    supabase
      .from("folders")
      .select("id, name")
      .eq("parent_folder_id", folderId)
      .eq("is_trashed", false)
  ]);

  let result: FileEntry[] = [];

  for (const file of files || []) {
    result.push({
      name: file.name,
      s3_key: file.s3_key,
      path: `${path}${file.name}`,
    });
  }

  // Use Promise.all for subfolder recursion to parallelize DB fetches
  if (folders && folders.length > 0) {
    const nestedResults = await Promise.all(
      folders.map(f => getAllFiles(f.id, `${path}${f.name}/`))
    );
    for (const nested of nestedResults) {
      result.push(...nested);
    }
  }

  return result;
}

export async function createFolderZipStream(folderId: string, folderName: string, downloadId?: string) {
  const allFiles = await getAllFiles(folderId);
  const totalFiles = allFiles.length;
  let filesProcessed = 0;

  const stream = new PassThrough();
  // 🔥 Optimization: Level 1 compression (Fastest) instead of Level 9
  const archive = archiver("zip", { zlib: { level: 1 } });

  archive.on("error", (err) => {
    console.error("[archiver error]", err);
    stream.destroy(err);
  });

  // 🔥 Progress Broadcasting
  let channel: any = null;
  if (downloadId) {
    channel = supabase.channel(`download:${downloadId}`);
    channel.subscribe((status: string) => {
      if (status === "SUBSCRIBED") {
        // Send an immediate "started" event to sync the UI
        channel.send({
          type: "broadcast",
          event: "progress",
          payload: {
            filesProcessed: 0,
            totalFiles,
            status: "started"
          }
        }).catch((err: any) => console.error("[broadcast error]", err));
      }
    });

    archive.on("entry", () => {
      filesProcessed++;
      channel.send({
        type: "broadcast",
        event: "progress",
        payload: {
          filesProcessed,
          totalFiles,
          status: "zipping"
        }
      }).catch((err: any) => console.error("[broadcast error]", err));
    });
  }

  archive.pipe(stream);

  // We don't await the entire pipeline here, we just start it.
  // But archiver needs files appended. We can parallelize the S3 stream starts.
  
  (async () => {
    try {
      for (const file of allFiles) {
        const s3Object = await s3.send(
          new GetObjectCommand({
            Bucket: BUCKET,
            Key: file.s3_key,
          })
        );

        if (s3Object.Body) {
          archive.append(s3Object.Body as any, { name: file.path });
        }
      }
      await archive.finalize();

      // Send final completion event
      if (channel) {
        channel.send({
          type: "broadcast",
          event: "progress",
          payload: {
            filesProcessed,
            totalFiles,
            status: "complete"
          }
        }).catch((err: any) => console.error("[finalize broadcast error]", err));
      }
    } catch (err) {
      console.error("[zip stream error]", err);
      archive.abort();
    }
  })();

  return {
    stream,
    fileName: `${folderName}.zip`
  };
}
