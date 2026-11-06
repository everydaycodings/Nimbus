// The phone's offline store: one SQLite file the JS side writes. Kotlin's Files app provider opens
// it read-only and reads only `offline_files`, so that table's shape is a contract (plans/android-app.md).
import { openDatabaseSync, type SQLiteDatabase } from "expo-sqlite"

let opened: SQLiteDatabase | null = null

export function db() {
  if (opened) return opened
  const d = openDatabaseSync("offline.db")
  d.execSync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS offline_files(account TEXT NOT NULL, id TEXT NOT NULL, version TEXT, name TEXT NOT NULL, mime TEXT, size INTEGER NOT NULL, path TEXT NOT NULL, parent TEXT, root TEXT, PRIMARY KEY(account,id));
    CREATE TABLE IF NOT EXISTS offline_marks(account TEXT NOT NULL, id TEXT NOT NULL, added INTEGER NOT NULL, parent TEXT, PRIMARY KEY(account,id));
    CREATE TABLE IF NOT EXISTS offline_items(account TEXT NOT NULL, id TEXT NOT NULL, parent TEXT, root TEXT NOT NULL, item TEXT NOT NULL, PRIMARY KEY(account,id));
    CREATE TABLE IF NOT EXISTS queue(seq INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL, op TEXT NOT NULL, label TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS failed(id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL, op TEXT NOT NULL, label TEXT NOT NULL, error TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS temp_ids(account TEXT NOT NULL, temp TEXT NOT NULL, real TEXT NOT NULL, PRIMARY KEY(account,temp));
    CREATE TABLE IF NOT EXISTS qcache(account TEXT NOT NULL, hash TEXT NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(account,hash));
  `)
  opened = d
  return d
}
