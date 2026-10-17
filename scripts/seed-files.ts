// Dev only: fills an account with sample folders and files so the browser has
// something to show before uploads exist. Files get fake `seed/` keys, no bytes.
// Run: npm run db:seed [email]   (defaults to the owner)
import postgres from "postgres"

const sql = postgres(process.env.DATABASE_URL!)
const email = process.argv[2]

const [me] = email
  ? await sql`select id, email from "user" where email = ${email}`
  : await sql`select id, email from "user" where role = 'owner'`
if (!me) {
  console.error(
    email ? `No account for ${email}.` : "No owner yet. Sign up first."
  )
  process.exit(1)
}
const [seeded] = await sql`
  select 1 from nodes where owner_id = ${me.id} and parent_id is null and name = 'Projects'`
if (seeded) {
  console.log(`${me.email} already has seed files.`)
  process.exit(0)
}

const DAY = 864e5
let n = 0
const ago = () => new Date(Date.now() - (n++ % 40) * DAY * 0.7)

type Tree = {
  [name: string]: Tree | [mime: string, size: number, starred?: boolean]
}
const tree: Tree = {
  Projects: {
    "Nimbus launch": {
      "brief.docx": [
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        48_200,
        true,
      ],
      "roadmap.pdf": ["application/pdf", 1_240_000],
      "hero.png": ["image/png", 2_810_000],
      "teaser.mp4": ["video/mp4", 84_300_000],
    },
    Archive: {
      "2025-assets.zip": ["application/zip", 412_000_000],
      "notes.txt": ["text/plain", 3_100],
    },
    "server.ts": ["text/plain", 7_420],
    "schema.sql": ["text/plain", 2_050],
  },
  Photos: {
    "Lisbon 2026": {
      "IMG_2041.jpg": ["image/jpeg", 4_120_000, true],
      "IMG_2042.jpg": ["image/jpeg", 3_980_000],
      "IMG_2043.heic": ["image/heic", 2_300_000],
    },
    "profile.webp": ["image/webp", 182_000],
  },
  Documents: {
    "Tax return 2025.pdf": ["application/pdf", 640_000, true],
    "budget.xlsx": [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      92_400,
    ],
    "lease.pdf": ["application/pdf", 1_020_000],
  },
  Music: {
    "demo-track.mp3": ["audio/mpeg", 6_700_000],
    "voice memo.m4a": ["audio/mp4", 1_400_000],
  },
  "README.md": ["text/markdown", 4_800],
  "Quarterly review.pptx": [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    5_600_000,
  ],
  "backup.tar.gz": ["application/gzip", 1_900_000_000],
  "invoice-0042.pdf": ["application/pdf", 210_000],
  "screenshot.png": ["image/png", 940_000],
}

async function plant(t: Tree, parentId: string | null) {
  for (const [name, v] of Object.entries(t)) {
    const at = ago()
    if (Array.isArray(v)) {
      const [mime, size, starred = false] = v
      const [row] = await sql`
        insert into nodes (owner_id, parent_id, kind, name, size, mime, s3_key, starred, created_at, updated_at)
        values (${me.id}, ${parentId}, 'file', ${name}, ${size}, ${mime}, ${"seed/" + crypto.randomUUID()}, ${starred}, ${at}, ${at})
        returning id, s3_key`
      await sql`
        with v as (
          insert into file_versions (node_id, number, s3_key, size, mime, uploaded_by, created_at)
          values (${row.id}, 1, ${row.s3_key}, ${size}, ${mime}, ${me.id}, ${at})
          returning id
        )
        update nodes set current_version_id = (select id from v) where id = ${row.id}`
    } else {
      const [row] = await sql`
        insert into nodes (owner_id, parent_id, kind, name, starred, created_at, updated_at)
        values (${me.id}, ${parentId}, 'folder', ${name}, ${name === "Photos"}, ${at}, ${at})
        returning id`
      await plant(v, row.id)
    }
  }
}

await plant(tree, null)
console.log(`Seeded ${n} items for ${me.email}.`)
await sql.end()
