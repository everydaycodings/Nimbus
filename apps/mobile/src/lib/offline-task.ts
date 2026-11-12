// Background refresh on the installed app: WorkManager wakes the JS, which runs the same refreshAll() as
// opening the app does. Expo Go has neither native module, so nothing is registered there.
import { requireOptionalNativeModule } from "expo"

import { refreshAll } from "./offline"
import { runDue } from "./phone-backup"

const TASK = "nimbus-offline-refresh"
// Android won't run it more often than every 15 minutes anyway; a few hours is plenty for files.
const EVERY_MINUTES = 6 * 60

export const backgroundRefreshAvailable = () => !!requireOptionalNativeModule("ExpoBackgroundTask") && !!requireOptionalNativeModule("ExpoTaskManager")

if (backgroundRefreshAvailable()) {
  const TaskManager = require("expo-task-manager") as typeof import("expo-task-manager")
  const { BackgroundTaskResult } = require("expo-background-task") as typeof import("expo-background-task")
  TaskManager.defineTask(TASK, async () => {
    try {
      await refreshAll()
      // Contacts and calendar backup, when it is due; it applies the camera backup's Wi-Fi and charging rules itself.
      await runDue()
      return BackgroundTaskResult.Success
    } catch {
      return BackgroundTaskResult.Failed
    }
  })
}

// Safe to call on every launch: registering again just keeps the one task.
export async function scheduleBackgroundRefresh() {
  if (!backgroundRefreshAvailable()) return
  try {
    const BackgroundTask = require("expo-background-task") as typeof import("expo-background-task")
    await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: EVERY_MINUTES })
  } catch {}
}
