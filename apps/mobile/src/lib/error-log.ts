// The last 50 errors, kept on this phone for Copy diagnostics. Never throws: logging must not cause errors.
import { openDatabaseSync, type SQLiteDatabase } from "expo-sqlite"

const KEEP = 50
let opened: SQLiteDatabase | null = null

function db() {
  if (!opened) {
    opened = openDatabaseSync("errors.db")
    opened.execSync("CREATE TABLE IF NOT EXISTS errors(id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, source TEXT NOT NULL, message TEXT NOT NULL)")
  }
  return opened
}

export function logError(source: string, e: unknown) {
  try {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 300)
    const d = db()
    d.runSync("INSERT INTO errors(at, source, message) VALUES (?, ?, ?)", Date.now(), source, message)
    d.runSync("DELETE FROM errors WHERE id <= (SELECT MAX(id) FROM errors) - ?", KEEP)
  } catch {}
}

export type LoggedError = { at: number; source: string; message: string }

export function loggedErrors(): LoggedError[] {
  try {
    return db().getAllSync<LoggedError>("SELECT at, source, message FROM errors ORDER BY id DESC")
  } catch {
    return []
  }
}
