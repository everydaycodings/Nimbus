// actions/sharing.dashboard.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function getUser(clerkId: string) {
  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .single();
  return data;
}

// ── Get all share links + permissions owned by the current user ──
export async function getMySharedItems() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await getUser(userId);
  if (!user) throw new Error("User not found");

  // Share links with resource names joined
  const { data: rawLinks } = await supabase
    .from("share_links")
    .select("id, token, role, expires_at, created_at, resource_id, resource_type")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  // Enrich links with resource names
  const links = await Promise.all(
    (rawLinks ?? []).map(async (link) => {
      const table = link.resource_type === "file" ? "files" : "folders";
      const select = link.resource_type === "file"
        ? "name, mime_type"
        : "name";

      const { data: resource } = await supabase
        .from(table)
        .select(select)
        .eq("id", link.resource_id)
        .single();

      return {
        ...link,
        resource_name: (resource as any)?.name ?? "Deleted item",
        mime_type:     (resource as any)?.mime_type ?? null,
      };
    })
  );

  // Permissions (shared with specific people)
  const { data: rawPerms } = await supabase
    .from("permissions")
    .select("id, resource_id, resource_type, user_id, role, created_at")
    .order("created_at", { ascending: false });

  // Filter to only permissions on resources owned by current user
  const myPerms: any[] = [];

  for (const perm of rawPerms ?? []) {
    const table = perm.resource_type === "file" ? "files" : "folders";
    const select = perm.resource_type === "file" ? "id, name, mime_type, owner_id" : "id, name, owner_id";

    const { data: resource } = await supabase
      .from(table)
      .select(select)
      .eq("id", perm.resource_id)
      .single();

    if (!resource || (resource as any).owner_id !== user.id) continue;

    const { data: sharedUser } = await supabase
      .from("users")
      .select("email, full_name")
      .eq("id", perm.user_id)
      .single();

    myPerms.push({
      permission_id: perm.id,
      resource_id:   perm.resource_id,
      resource_type: perm.resource_type,
      resource_name: (resource as any).name ?? "Deleted item",
      mime_type:     (resource as any).mime_type ?? null,
      role:          perm.role,
      user_email:    sharedUser?.email    ?? "Unknown",
      user_name:     sharedUser?.full_name ?? null,
      shared_at:     perm.created_at,
    });
  }

  return { links, people: myPerms };
}

// ── Revoke a share link ───────────────────────────────────────
export async function revokeShareLink(linkId: string) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await getUser(userId);
  if (!user) throw new Error("User not found");

  const { error } = await supabase
    .from("share_links")
    .delete()
    .eq("id", linkId)
    .eq("owner_id", user.id);

  if (error) throw new Error(error.message);
}

// ── Revoke a user permission ──────────────────────────────────
export async function revokeUserPermission(permissionId: string) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await getUser(userId);
  if (!user) throw new Error("User not found");

  // Verify the permission is on a resource owned by this user
  const { data: perm } = await supabase
    .from("permissions")
    .select("id, resource_id, resource_type")
    .eq("id", permissionId)
    .single();

  if (!perm) throw new Error("Permission not found");

  const table = perm.resource_type === "file" ? "files" : "folders";
  const { data: resource } = await supabase
    .from(table)
    .select("owner_id")
    .eq("id", perm.resource_id)
    .single();

  if (!resource || (resource as any).owner_id !== user.id) {
    throw new Error("Access denied");
  }

  const { error } = await supabase
    .from("permissions")
    .delete()
    .eq("id", permissionId);

  if (error) throw new Error(error.message);
}