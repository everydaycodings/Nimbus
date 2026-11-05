// Applies the migrations in drizzle/ without drizzle-kit (a dev dependency), so
// the production image can run it. Same bookkeeping table as `npm run db:migrate`.
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })
await migrate(drizzle(sql), { migrationsFolder: "drizzle" })
await sql.end()
console.log("Migrations applied.")
