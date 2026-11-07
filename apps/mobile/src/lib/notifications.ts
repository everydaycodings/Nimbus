import type { Notification } from "@nimbus/shared/api"

export type Target =
  | { to: "browser"; path: string }
  | { to: "item"; id: string }
  | { to: "route"; path: "/storage" | "/transfers" | "/account/devices" | "/(tabs)/(shared)/home" }

// `href` is a web path. The app has its own screens for all of them but admin.
export function notificationTarget(n: Pick<Notification, "kind" | "href" | "nodeId">): Target {
  if (n.href.startsWith("/admin")) return { to: "browser", path: n.href }
  if (n.kind === "app_password") return { to: "route", path: "/account/devices" }
  if (n.kind === "transfer_download") return { to: "route", path: "/transfers" }
  if (n.kind === "storage_low") return { to: "route", path: "/storage" }
  if (n.nodeId) return { to: "item", id: n.nodeId }
  return { to: "route", path: "/(tabs)/(shared)/home" }
}
