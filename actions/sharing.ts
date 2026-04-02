// actions/sharing.ts
"use server";

import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { s3, BUCKET } from "@/lib/s3";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function getUser(userId: string) {
  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("id", userId)
    .single();
  return data;
}

// ── Share with a specific user by email ──────────────────────
export async function shareWithUser(
  resourceId:   string,
  resourceType: "file" | "folder",
  email:        string,
  role:         "viewer" | "editor"
) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const owner = await getUser(userId);
  if (!owner) throw new Error("User not found");

  // Verify the resource belongs to this user
  const table = resourceType === "file" ? "files" : "folders";
  const { data: resource } = await supabase
    .from(table)
    .select("id")
    .eq("id", resourceId)
    .eq("owner_id", owner.id)
    .single();

  if (!resource) throw new Error("Resource not found or access denied");

  // Find the target user by email
  const { data: target } = await supabase
    .from("users")
    .select("id, email")
    .eq("email", email.toLowerCase().trim())
    .single();

  if (!target) throw new Error("No Nimbus account found with that email address");
  if (target.id === owner.id) throw new Error("You cannot share with yourself");

  // Upsert permission — update role if already shared
  const { error } = await supabase
    .from("permissions")
    .upsert(
      {
        resource_id:   resourceId,
        resource_type: resourceType,
        user_id:       target.id,
        role,
      },
      { onConflict: "resource_id,resource_type,user_id" }
    );

  if (error) throw new Error(error.message);

  return { email: target.email, role };
}

// ── Remove a user's permission ────────────────────────────────
export async function removePermission(
  resourceId:   string,
  resourceType: "file" | "folder",
  targetUserId: string
) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const owner = await getUser(userId);
  if (!owner) throw new Error("User not found");

  const table = resourceType === "file" ? "files" : "folders";
  const { data: resource } = await supabase
    .from(table)
    .select("id")
    .eq("id", resourceId)
    .eq("owner_id", owner.id)
    .single();

  if (!resource) throw new Error("Resource not found or access denied");

  const { error } = await supabase
    .from("permissions")
    .delete()
    .eq("resource_id", resourceId)
    .eq("resource_type", resourceType)
    .eq("user_id", targetUserId);

  if (error) throw new Error(error.message);
}

// ── Update a user's role ──────────────────────────────────────
export async function updatePermissionRole(
  resourceId:   string,
  resourceType: "file" | "folder",
  targetUserId: string,
  role:         "viewer" | "editor"
) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const owner = await getUser(userId);
  if (!owner) throw new Error("User not found");

  const { error } = await supabase
    .from("permissions")
    .update({ role })
    .eq("resource_id", resourceId)
    .eq("resource_type", resourceType)
    .eq("user_id", targetUserId);

  if (error) throw new Error(error.message);
}

// ── Get all people a resource is shared with ─────────────────
export async function getSharedUsers(
  resourceId:   string,
  resourceType: "file" | "folder"
) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const owner = await getUser(userId);
  if (!owner) throw new Error("User not found");

  const { data, error } = await supabase
    .from("permissions")
    .select("user_id, role, users(id, email, name, avatar_url)")
    .eq("resource_id", resourceId)
    .eq("resource_type", resourceType);

  if (error) throw new Error(error.message);
  return data ?? [];
}

// ── Create a public share link ────────────────────────────────
export async function createShareLink(
  resourceId:    string,
  resourceType:  "file" | "folder",
  role:          "viewer" | "editor",
  expiresInDays?: number,  // undefined = never expires
  password?:     string,   // undefined = no password
  maxViews?:     number,   // undefined = unlimited
  selfDestructTarget: "link" | "resource" = "link"
) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const owner = await getUser(userId);
  if (!owner) throw new Error("User not found");

  const table = resourceType === "file" ? "files" : "folders";
  const { data: resource } = await supabase
    .from(table)
    .select("id")
    .eq("id", resourceId)
    .eq("owner_id", owner.id)
    .single();

  if (!resource) throw new Error("Resource not found or access denied");

  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 86400000).toISOString()
    : null;

  const passwordHash = password && password.trim()
    ? await bcrypt.hash(password.trim(), 10)
    : null;

  const { data, error } = await supabase
    .from("share_links")
    .insert({
      resource_id:          resourceId,
      resource_type:        resourceType,
      owner_id:             owner.id,
      role,
      expires_at:           expiresAt,
      password_hash:        passwordHash,
      max_views:            (maxViews && maxViews > 0) ? maxViews : null,
      self_destruct_target: selfDestructTarget,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  // Return a safe version — never expose the hash to the client
  return {
    ...data,
    is_password_protected: !!data.password_hash,
    password_hash: undefined,
  };
}

// ── Get existing share links for a resource ───────────────────
export async function getShareLinks(
  resourceId:   string,
  resourceType: "file" | "folder"
) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const owner = await getUser(userId);
  if (!owner) throw new Error("User not found");

  const { data, error } = await supabase
    .from("share_links")
    .select("id, token, role, expires_at, created_at, password_hash, max_views, view_count, self_destruct_target")
    .eq("resource_id", resourceId)
    .eq("resource_type", resourceType)
    .eq("owner_id", owner.id)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  // Convert password_hash to a safe boolean — never send the hash to the client
  return (data ?? []).map((row) => ({
    ...row,
    is_password_protected: !!row.password_hash,
    password_hash: undefined,
  }));
}

// ── Delete a share link ───────────────────────────────────────
export async function deleteShareLink(linkId: string) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const owner = await getUser(userId);
  if (!owner) throw new Error("User not found");

  const { error } = await supabase
    .from("share_links")
    .delete()
    .eq("id", linkId)
    .eq("owner_id", owner.id);

  if (error) throw new Error(error.message);
}

// ── Record a view check (Bot safe - doesn't increment yet) ───
export async function recordShareView(linkId: string, ip: string) {
  const { data: link } = await supabase
    .from("share_links")
    .select("id, token, view_count, max_views, expires_at, self_destruct_target, resource_id, resource_type")
    .eq("id", linkId)
    .single();

  if (!link) return null;

  // Check if this IP already has an active or pending view
  const { data: view } = await supabase
    .from("share_views")
    .select("view_status, activated_at")
    .eq("link_id", linkId)
    .eq("ip_address", ip)
    .maybeSingle();

  return {
    ...link,
    user_view: view || { view_status: "pending", activated_at: null }
  };
}

// ── Start the actual view (Called when user clicks "Reveal") ─
export async function startShareView(linkId: string, ip: string) {
  // 1. Check if already active
  const { data: existing } = await supabase
    .from("share_views")
    .select("view_status")
    .eq("link_id", linkId)
    .eq("ip_address", ip)
    .maybeSingle();

  if (existing?.view_status === "active") {
    return { success: true };
  }

  // 2. Increment global view count
  const { data: link, error: updateError } = await supabase.rpc("increment_link_views", {
    p_link_id: linkId
  });

  if (updateError) throw new Error(updateError.message);

  // 3. Mark this IP view as active
  await supabase
    .from("share_views")
    .upsert({
      link_id:      linkId,
      ip_address:   ip,
      view_status:  "active",
      activated_at: new Date().toISOString(),
      last_view_at: new Date().toISOString()
    }, { onConflict: "link_id, ip_address" });

  return { success: true, link };
}

// ── Finish a view (Called on tab close or manual close) ──────
export async function finishShareView(linkId: string, ip: string) {
  const { data: view } = await supabase
    .from("share_views")
    .select("view_status")
    .eq("link_id", linkId)
    .eq("ip_address", ip)
    .maybeSingle();

  if (!view || view.view_status === "consumed") return;

  // Mark as consumed
  await supabase
    .from("share_views")
    .update({ view_status: "consumed" })
    .eq("link_id", linkId)
    .eq("ip_address", ip);

  // Check if we need to self-destruct the resource
  const { data: link } = await supabase
    .from("share_links")
    .select("view_count, max_views, self_destruct_target")
    .eq("id", linkId)
    .single();

  if (link && link.max_views && link.view_count >= link.max_views) {
    // If all views are consumed (or we just reached the limit), and target is resource, delete it.
    // In "View Once", we can be aggressive.
    if (link.self_destruct_target === "resource") {
      await performSelfDestruct(linkId);
    } else {
      await supabase.from("share_links").delete().eq("id", linkId);
    }
  }
}

// ── Perform full resource self-destruct ───────────────────────
export async function performSelfDestruct(linkId: string) {
  // Use service role via the 'supabase' client already defined at top
  const { data: link } = await supabase
    .from("share_links")
    .select("id, resource_id, resource_type")
    .eq("id", linkId)
    .single();

  if (!link) return;

  if (link.resource_type === "file") {
    const { data: file } = await supabase
      .from("files")
      .select("s3_key")
      .eq("id", link.resource_id)
      .single();

    if (file) {
      // Delete from S3
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: file.s3_key }));
      } catch (err) {
         console.error("Failed to delete from S3 during self-destruct:", err);
      }
      // Delete from DB
      await supabase.from("files").delete().eq("id", link.resource_id);
    }
  } else {
    // For folders, we need to delete recursively
    const deleteFolderContents = async (folderId: string) => {
       const { data: files } = await supabase.from("files").select("id, s3_key").eq("parent_folder_id", folderId);
       if (files) {
         for (const f of files) {
           try {
             await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: f.s3_key }));
           } catch (err) {}
           await supabase.from("files").delete().eq("id", f.id);
         }
       }
       const { data: subfolders } = await supabase.from("folders").select("id").eq("parent_folder_id", folderId);
       if (subfolders) {
         for (const s of subfolders) {
           await deleteFolderContents(s.id);
         }
       }
       await supabase.from("folders").delete().eq("id", folderId);
    };

    await deleteFolderContents(link.resource_id);
  }

  // Delete all share links for this resource
  await supabase.from("share_links").delete().eq("resource_id", link.resource_id);
}