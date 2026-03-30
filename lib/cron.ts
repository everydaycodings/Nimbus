// lib/cron.ts
import cron from "node-cron";
import { cleanupTrash, cleanupExpiredLinks } from "@/actions/cleanup";

/**
 * Initializes background cron jobs for the application.
 * This should be called from instrumentation.ts exactly once.
 */
export function initCronJobs() {
  // 1. Sharing Cleanup - Every 5 minutes
  cron.schedule("*/5 * * * *", async () => {
    try {
      await cleanupExpiredLinks();
    } catch (error) {
      console.error("[Cron] Sharing cleanup failed:", error);
    }
  });

  // 2. Trash Cleanup - Every day at 3:00 AM
  cron.schedule("0 3 * * *", async () => {
    try {
      await cleanupTrash();
    } catch (error) {
      console.error("[Cron] Trash cleanup failed:", error);
    }
  });
}
