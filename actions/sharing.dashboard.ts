// actions/sharing.dashboard.ts
"use server";

import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function getUser(userId: string) {
  const { data } = await supabase.from("users").select("id").eq("id", userId).single();
  return data;
}

// ── My shared items ───────────────────────────────────────────
export async function getMySharedItems() {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");
  const user = await getUser(userId);
  if (!user) throw new Error("User not found");

  const { data: rawLinks } = await supabase
    .from("share_links")
    .select("id, token, role, expires_at, created_at, resource_id, resource_type, password_hash")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  const links = await Promise.all(
    (rawLinks ?? []).map(async (link) => {
      const table  = link.resource_type === "file" ? "files" : "folders";
      const select = link.resource_type === "file" 
        ? "name, mime_type, tags:file_tags(tag:tags(id, name, color))" 
        : "name, tags:folder_tags(tag:tags(id, name, color))";
      const { data: resource } = await supabase.from(table).select(select).eq("id", link.resource_id).single();
      return { 
        ...link, 
        is_password_protected: !!link.password_hash,
        password_hash: undefined,
        resource_name: (resource as any)?.name ?? "Deleted item", 
        mime_type: (resource as any)?.mime_type ?? null, 
        tags: (resource as any)?.tags ?? [] 
      };
    })
  );

  const { data: rawPerms } = await supabase
    .from("permissions")
    .select("id, resource_id, resource_type, user_id, role, created_at")
    .order("created_at", { ascending: false });

  const people: any[] = [];
  for (const perm of rawPerms ?? []) {
    const table  = perm.resource_type === "file" ? "files" : "folders";
    const select = perm.resource_type === "file" 
      ? "id, name, mime_type, owner_id, tags:file_tags(tag:tags(id, name, color))" 
      : "id, name, owner_id, tags:folder_tags(tag:tags(id, name, color))";
    const { data: resource } = await supabase.from(table).select(select).eq("id", perm.resource_id).single();
    if (!resource || (resource as any).owner_id !== user.id) continue;
    const { data: sharedUser } = await supabase.from("users").select("email, full_name").eq("id", perm.user_id).single();
    people.push({
      permission_id: perm.id, resource_id: perm.resource_id,
      resource_type: perm.resource_type, resource_name: (resource as any).name ?? "Deleted item",
      mime_type: (resource as any).mime_type ?? null, role: perm.role,
      user_email: sharedUser?.email ?? "Unknown", user_name: sharedUser?.full_name ?? null,
      shared_at: perm.created_at, tags: (resource as any).tags ?? [],
    });
  }

  return { links, people };
}

// ── Items shared WITH me ──────────────────────────────────────
export async function getSharedWithMe() {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");
  const user = await getUser(userId);
  if (!user) throw new Error("User not found");

  const { data: perms } = await supabase
    .from("permissions")
    .select("id, resource_id, resource_type, role, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const items: any[] = [];
  for (const perm of perms ?? []) {
    const table  = perm.resource_type === "file" ? "files" : "folders";
    const select = perm.resource_type === "file"
      ? "id, name, mime_type, size, s3_key, owner_id, tags:file_tags(tag:tags(id, name, color))"
      : "id, name, owner_id, tags:folder_tags(tag:tags(id, name, color))";
    const { data: resource } = await supabase.from(table).select(select).eq("id", perm.resource_id).single();
    if (!resource || (resource as any).owner_id === user.id) continue;
    const { data: owner } = await supabase.from("users").select("email, full_name").eq("id", (resource as any).owner_id).single();
    items.push({
      permission_id: perm.id, resource_id: perm.resource_id,
      resource_type: perm.resource_type, role: perm.role, shared_at: perm.created_at,
      name: (resource as any).name, mime_type: (resource as any).mime_type ?? null,
      size: (resource as any).size ?? null, s3_key: (resource as any).s3_key ?? null,
      owner_email: owner?.email ?? "Unknown", owner_name: owner?.full_name ?? null,
      tags: (resource as any).tags ?? [],
    });
  }
  return items;
}

// ── Download URL for a single shared file ─────────────────────
export async function getSharedFileDownloadUrl(resourceId: string) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");
  const user = await getUser(userId);
  if (!user) throw new Error("User not found");

  const { data: perm } = await supabase.from("permissions").select("id").eq("resource_id", resourceId).eq("user_id", user.id).single();
  if (!perm) throw new Error("Access denied");

  const { data: file } = await supabase.from("files").select("name, s3_key, mime_type, s3_bucket").eq("id", resourceId).single();
  if (!file) throw new Error("File not found");

  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl }     = await import("@aws-sdk/s3-request-presigner");
  const { s3, BUCKET }       = await import("@/lib/s3");

  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: file.s3_bucket ?? BUCKET, Key: file.s3_key,
      ResponseContentDisposition: `attachment; filename="${file.name}"`,
      ResponseContentType: file.mime_type,
    }),
    { expiresIn: 3600 }
  );
  return { url, name: file.name, mimeType: file.mime_type };
}

// ── Get all files in a folder recursively (for zip) ──────────
async function collectFolderFiles(
  folderId: string,
  pathPrefix: string
): Promise<{ s3Key: string; s3Bucket: string; zipPath: string }[]> {
  const { BUCKET } = await import("@/lib/s3");

  const [{ data: files }, { data: subFolders }] = await Promise.all([
    supabase
      .from("files")
      .select("name, s3_key, s3_bucket")
      .eq("parent_folder_id", folderId)
      .eq("is_trashed", false)
      .eq("upload_status", "complete"),
    supabase
      .from("folders")
      .select("id, name")
      .eq("parent_folder_id", folderId)
      .eq("is_trashed", false),
  ]);

  const result: { s3Key: string; s3Bucket: string; zipPath: string }[] = [];

  for (const file of files ?? []) {
    result.push({
      s3Key:    file.s3_key,
      s3Bucket: file.s3_bucket ?? BUCKET,
      zipPath:  `${pathPrefix}/${file.name}`,
    });
  }

  for (const sub of subFolders ?? []) {
    const children = await collectFolderFiles(sub.id, `${pathPrefix}/${sub.name}`);
    result.push(...children);
  }

  return result;
}

// ── Build a zip of a shared folder and return as base64 ───────
// We return base64 so it can cross the server action boundary.
// The client converts it back to a Blob and triggers download.
export async function getSharedFolderZip(resourceId: string): Promise<{ base64: string; fileName: string }> {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");
  const user = await getUser(userId);
  if (!user) throw new Error("User not found");

  const { data: perm } = await supabase.from("permissions").select("id").eq("resource_id", resourceId).eq("user_id", user.id).single();
  if (!perm) throw new Error("Access denied");

  const { data: folder } = await supabase.from("folders").select("name").eq("id", resourceId).single();
  if (!folder) throw new Error("Folder not found");

  const entries = await collectFolderFiles(resourceId, folder.name);

  // Use JSZip (install: npm install jszip)
  const JSZip = (await import("jszip")).default;
  const zip   = new JSZip();

  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const { s3 }               = await import("@/lib/s3");

  // Fetch all files from S3 and add to zip
  await Promise.allSettled(
    entries.map(async (entry) => {
      const res = await s3.send(new GetObjectCommand({ Bucket: entry.s3Bucket, Key: entry.s3Key }));
      if (!res.Body) return;

      // Convert the readable stream to a Buffer
      const chunks: Uint8Array[] = [];
      for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      zip.file(entry.zipPath, buffer);
    })
  );

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return {
    base64:   zipBuffer.toString("base64"),
    fileName: `${folder.name}.zip`,
  };
}

// ── Copy shared file to my drive ─────────────────────────────
export async function copySharedFileToDrive(resourceId: string, targetFolderId: string | null) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");
  const user = await getUser(userId);
  if (!user) throw new Error("User not found");

  const { data: perm } = await supabase.from("permissions").select("id").eq("resource_id", resourceId).eq("user_id", user.id).single();
  if (!perm) throw new Error("Access denied");

  const { data: file } = await supabase.from("files").select("name, mime_type, size, s3_key, s3_bucket").eq("id", resourceId).single();
  if (!file) throw new Error("File not found");

  const { CopyObjectCommand } = await import("@aws-sdk/client-s3");
  const { s3, BUCKET }        = await import("@/lib/s3");
  const { randomUUID }        = await import("crypto");

  const ext    = file.name.split(".").pop();
  const newKey = `uploads/${user.id}/${randomUUID()}.${ext}`;

  await s3.send(new CopyObjectCommand({
    Bucket: file.s3_bucket ?? BUCKET,
    CopySource: `${file.s3_bucket ?? BUCKET}/${file.s3_key}`,
    Key: newKey,
  }));

  const { data: newFile, error } = await supabase.from("files").insert({
    name: `Copy of ${file.name}`, mime_type: file.mime_type, size: file.size,
    s3_key: newKey, s3_bucket: file.s3_bucket ?? BUCKET,
    owner_id: user.id, parent_folder_id: targetFolderId, upload_status: "complete",
  }).select().single();

  if (error) throw new Error(error.message);
  return newFile;
}

// ── Copy shared folder to my drive ───────────────────────────
export async function copySharedFolderToDrive(resourceId: string, targetFolderId: string | null) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");
  const user = await getUser(userId);
  if (!user) throw new Error("User not found");

  const { data: perm } = await supabase.from("permissions").select("id").eq("resource_id", resourceId).eq("user_id", user.id).single();
  if (!perm) throw new Error("Access denied");

  const { data: folder } = await supabase.from("folders").select("name").eq("id", resourceId).single();
  if (!folder) throw new Error("Folder not found");

  await deepCopyFolder(resourceId, folder.name, targetFolderId, user.id);
}

async function deepCopyFolder(sourceFolderId: string, name: string, targetParentId: string | null, ownerId: string) {
  const { CopyObjectCommand } = await import("@aws-sdk/client-s3");
  const { s3, BUCKET }        = await import("@/lib/s3");
  const { randomUUID }        = await import("crypto");

  const { data: newFolder } = await supabase.from("folders").insert({
    name, owner_id: ownerId, parent_folder_id: targetParentId,
  }).select("id").single();

  if (!newFolder) return;

  const { data: files } = await supabase.from("files").select("id, name, mime_type, size, s3_key, s3_bucket").eq("parent_folder_id", sourceFolderId).eq("is_trashed", false).eq("upload_status", "complete");
  await Promise.allSettled(
    (files ?? []).map(async (file) => {
      const ext    = file.name.split(".").pop();
      const newKey = `uploads/${ownerId}/${randomUUID()}.${ext}`;
      await s3.send(new CopyObjectCommand({ Bucket: file.s3_bucket ?? BUCKET, CopySource: `${file.s3_bucket ?? BUCKET}/${file.s3_key}`, Key: newKey }));
      await supabase.from("files").insert({ name: file.name, mime_type: file.mime_type, size: file.size, s3_key: newKey, s3_bucket: file.s3_bucket ?? BUCKET, owner_id: ownerId, parent_folder_id: newFolder.id, upload_status: "complete" });
    })
  );

  const { data: subFolders } = await supabase.from("folders").select("id, name").eq("parent_folder_id", sourceFolderId).eq("is_trashed", false);
  for (const sub of subFolders ?? []) {
    await deepCopyFolder(sub.id, sub.name, newFolder.id, ownerId);
  }
}

export async function revokeShareLink(linkId: string) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");
  const user = await getUser(userId);
  if (!user) throw new Error("User not found");
  await supabase.from("share_links").delete().eq("id", linkId).eq("owner_id", user.id);
}

export async function revokeUserPermission(permissionId: string) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");
  const user = await getUser(userId);
  if (!user) throw new Error("User not found");
  const { data: perm } = await supabase.from("permissions").select("id, resource_id, resource_type").eq("id", permissionId).single();
  if (!perm) throw new Error("Permission not found");
  const table = perm.resource_type === "file" ? "files" : "folders";
  const { data: resource } = await supabase.from(table).select("owner_id").eq("id", perm.resource_id).single();
  if (!resource || (resource as any).owner_id !== user.id) throw new Error("Access denied");
  await supabase.from("permissions").delete().eq("id", permissionId);
}