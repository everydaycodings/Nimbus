// app/api/verify-share-password/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { token, password } = await req.json();

    if (!token || !password) {
      return NextResponse.json({ ok: false, error: "Missing fields" }, { status: 400 });
    }

    // Fetch the link (service role bypasses RLS so unauthenticated visitors can verify)
    const { data: link, error } = await supabase
      .from("share_links")
      .select("token, password_hash, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (error || !link) {
      return NextResponse.json({ ok: false, error: "Link not found" }, { status: 404 });
    }

    // Reject expired links
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return NextResponse.json({ ok: false, error: "Link expired" }, { status: 410 });
    }

    // No password set — nothing to verify
    if (!link.password_hash) {
      return NextResponse.json({ ok: false, error: "Link is not password protected" }, { status: 400 });
    }

    const match = await bcrypt.compare(password, link.password_hash);

    if (!match) {
      return NextResponse.json({ ok: false, error: "Incorrect password" }, { status: 401 });
    }

    // Set an HttpOnly cookie scoped to this specific share link (1 hour)
    const res = NextResponse.json({ ok: true });
    res.cookies.set(`share_unlocked_${token}`, "1", {
      httpOnly: true,
      path:     `/share/${token}`,
      maxAge:   60 * 60, // 1 hour
      sameSite: "lax",
    });
    return res;
  } catch {
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
