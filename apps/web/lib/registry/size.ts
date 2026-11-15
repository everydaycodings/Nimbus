import { formatBytes } from "@/lib/file-rules"

// A size, or a dash when it isn't known (a cached index whose images aren't stored yet).
export const sizeOf = (bytes: number) => (bytes > 0 ? formatBytes(bytes) : "—")
