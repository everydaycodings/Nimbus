// instrumentation.ts
export async function register() {
  // Only run in the Node.js runtime, as cron jobs don't work in Edge.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { initCronJobs } = await import("@/lib/cron");
      // Use a delay or check to avoid double initialization in some dev environments
      // but in production, register() is called once per server instance.
      initCronJobs();
    } catch (error) {
      console.error("[Instrumentation] Failed to initialize cron jobs:", error);
    }
  }
}
