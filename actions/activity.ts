"use server";
import { createClient } from "@/lib/supabase/server";

export async function getActivityLogs(page = 1, limit = 10) {
  const supabase = await createClient();
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const { data, error, count } = await supabase
    .from("activity_log")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    if (error.code === 'PGRST103') {
      return { logs: [], totalCount: count || 0, hasMore: false };
    }
    console.error("Error fetching activity logs:", error);
    throw new Error("Could not fetch activity logs");
  }

  return { 
    logs: data || [], 
    totalCount: count || 0,
    hasMore: count ? (from + (data?.length || 0)) < count : false
  };
}
