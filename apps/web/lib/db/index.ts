import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import * as schema from "./schema"

const url = process.env.DATABASE_URL
if (!url) throw new Error("DATABASE_URL is not set")

// Reuse one pool across dev hot reloads instead of leaking a new one per edit.
const globalForDb = globalThis as unknown as { pg?: postgres.Sql }
const client = globalForDb.pg ?? postgres(url)
if (process.env.NODE_ENV !== "production") globalForDb.pg = client

export const db = drizzle(client, { schema })
