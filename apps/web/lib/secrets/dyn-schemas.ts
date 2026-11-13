// Request bodies for the dynamic-credential routes (a route file can only export handlers).
import { z } from "zod"

export const connSchema = z.object({
  name: z.string().max(60).optional(),
  engine: z.string().max(12).optional(),
  host: z.string().max(255).optional(),
  port: z.number().optional(),
  database: z.string().max(63).optional(),
  tls: z.boolean().optional(),
  adminUser: z.string().max(100).optional(),
  adminPassword: z.string().max(500).optional(),
  createSql: z.string().max(5000).optional(),
  revokeSql: z.string().max(5000).optional(),
  defaultTtl: z.union([z.string().max(10), z.number()]).optional(),
  maxTtl: z.union([z.string().max(10), z.number()]).optional(),
})

export const rotSchema = z.object({
  secretId: z.string().max(40).optional(),
  connectionId: z.string().max(40).optional(),
  username: z.string().max(63).optional(),
  mode: z.enum(["single", "alternate"]).optional(),
  usernameB: z.string().max(63).optional(),
  usernameKey: z.string().max(100).optional(),
  intervalDays: z.number().nullable().optional(),
})
