// actions/sharing.ts
"use server";

import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

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
    .select("user_id, role, users(id, email, full_name, avatar_url)")
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
  password?:     string    // undefined = no password
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
      resource_id:   resourceId,
      resource_type: resourceType,
      owner_id:      owner.id,
      role,
      expires_at:    expiresAt,
      password_hash: passwordHash,
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
    .select("id, token, role, expires_at, created_at, password_hash")
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