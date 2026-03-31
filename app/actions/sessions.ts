"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function getUserSessions() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Unauthorized");
  }

  const { data: { session: currentSession } } = await supabase.auth.getSession();
  
  let currentSessionId = null;
  if (currentSession?.access_token) {
    try {
      const payload = JSON.parse(Buffer.from(currentSession.access_token.split(".")[1], "base64").toString());
      currentSessionId = payload.sid;
    } catch (e) {
      console.error("Failed to decode session token", e);
    }
  }

  const { data: sessions, error } = await supabase.rpc("get_user_sessions");

  if (error) {
    console.error("Error fetching sessions:", error);
    return { sessions: [], currentSessionId };
  }

  return {
    sessions: sessions || [],
    currentSessionId
  };
}

export async function revokeSession(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_user_session", { session_id: id });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/settings");
}

export async function revokeOtherSessions(currentSessionId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_other_sessions", { current_session_id: currentSessionId });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/settings");
}
