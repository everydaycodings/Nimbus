// app/api/webhooks/clerk/route.ts
import { Webhook } from "svix";
import { headers } from "next/headers";
import { WebhookEvent } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

console.log("🔥 Clerk webhook received");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function POST(req: Request) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;
  if (!WEBHOOK_SECRET) {
    return new Response("Missing CLERK_WEBHOOK_SECRET", { status: 500 });
  }

  // ── Verify the webhook signature ────────────────────────────
  const headerPayload = await headers();
  const svix_id        = headerPayload.get("svix-id");
  const svix_timestamp = headerPayload.get("svix-timestamp");
  const svix_signature = headerPayload.get("svix-signature");

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response("Missing svix headers", { status: 400 });
  }

  const payload = await req.json();
  const body    = JSON.stringify(payload);
  const wh      = new Webhook(WEBHOOK_SECRET);

  let event: WebhookEvent;
  try {
    event = wh.verify(body, {
      "svix-id":        svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    }) as WebhookEvent;
  } catch {
    return new Response("Invalid webhook signature", { status: 400 });
  }

  // ── Handle events ────────────────────────────────────────────
  const { type, data } = event;

  if (type === "user.created") {
    const { error } = await supabase.from("users").insert({
      clerk_id:   data.id,
      email:      data.email_addresses[0]?.email_address ?? "",
      full_name:  [data.first_name, data.last_name].filter(Boolean).join(" ") || null,
      avatar_url: data.image_url ?? null,
    });

    if (error) {
      console.error("[webhook] user.created error:", error);
      return new Response("DB insert failed", { status: 500 });
    }

    console.log("[webhook] user created:", data.id);
  }

  if (type === "user.updated") {
    const { error } = await supabase
      .from("users")
      .update({
        email:      data.email_addresses[0]?.email_address ?? "",
        full_name:  [data.first_name, data.last_name].filter(Boolean).join(" ") || null,
        avatar_url: data.image_url ?? null,
      })
      .eq("clerk_id", data.id);

    if (error) {
      console.error("[webhook] user.updated error:", error);
      return new Response("DB update failed", { status: 500 });
    }

    console.log("[webhook] user updated:", data.id);
  }

  if (type === "user.deleted") {
    const { error } = await supabase
      .from("users")
      .delete()
      .eq("clerk_id", data.id);

    if (error) {
      console.error("[webhook] user.deleted error:", error);
      return new Response("DB delete failed", { status: 500 });
    }

    console.log("[webhook] user deleted:", data.id);
  }

  return new Response("OK", { status: 200 });
}