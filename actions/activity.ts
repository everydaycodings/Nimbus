"use server";
import { createClient } from "@/lib/supabase/server";

export async function getActivityLogs(limit = 10) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("activity_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Error fetching activity logs:", error);
    throw new Error("Could not fetch activity logs");
  }
  return data;
}
