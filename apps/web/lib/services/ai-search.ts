// Search by what's in a photo (CLIP) and by who's in it (Phase 20). Extra hits that
// searchItems puts after the text matches. Both only ever return files the viewer can see.
import "server-only"

import { sql, type SQL } from "drizzle-orm"

import { aiConfig, aiFlags, hasVector } from "@/lib/ai"
import { db } from "@/lib/db"
import { CLIP_MIN_SIM, CLIP_NEAR_BEST, ml, mlBase, vecLiteral } from "@/lib/ml"
import { redis } from "@/lib/redis"

// The query's vector, kept 10 minutes so paging and typing again don't wait for the service.
async function queryVector(q: string, url: string, model: string) {
  const key = `ml:clipq:${model}:${q.toLowerCase()}`
  const hit = await redis.get(key).catch(() => null)
  if (hit) return JSON.parse(hit) as number[]
  const v = await ml(mlBase(url)).clipText(q, model)
  await redis.set(key, JSON.stringify(v), "EX", 600).catch(() => {})
  return v
}

// Files whose picture (or video frame) looks like `q`, best first; videos carry the frame's time.
// `visible`: the CTE searchItems uses for what's shared with the viewer (named `shared`).
// ponytail: the HNSW index finds its nearest rows before the visibility join filters them; on a
// big multi-user library raise hnsw.ef_search or use iterative scans.
export async function pictureHits(viewer: string, q: string, limit: number, visible: SQL) {
  const s = await aiConfig()
  if (!s.mlClip || !(await aiFlags(viewer, s)).picture) return []
  let vec: number[]
  try {
    vec = await queryVector(q, s.mlUrl, s.clipModel)
  } catch {
    return [] // the service is down: text results still show
  }
  const lit = vecLiteral(vec)
  const rows = await db.execute<{ id: string; t_ms: number | null }>(sql`
    with recursive ${visible}
    select id, (array_agg(t_ms order by d))[1] as t_ms from (
      select *, min(d) over () as best from (
        select e.node_id as id, e.t_ms, e.vec <=> ${lit}::vector as d
        from node_embeddings e
        join nodes n on n.id = e.node_id and n.current_version_id = e.version_id
        where e.model = ${s.clipModel} and n.trashed_at is null and n.vault_id is null
          and (n.owner_id = ${viewer} or n.id in (select id from shared))
        order by d limit 200) top) x
    -- Above an absolute floor, and close to the best match so one good hit doesn't drag in weak ones.
    where d <= ${1 - (CLIP_MIN_SIM[s.clipModel] ?? 0.26)} and d <= best + ${CLIP_NEAR_BEST}
    group by id order by min(d) limit ${limit}`)
  return rows.map((r) => ({ id: r.id, tMs: r.t_ms }))
}

// The viewer's own photos of people whose name matches `q`. Faces never cross accounts,
// so only the viewer's own people and own files.
export async function personHits(viewer: string, q: string, limit: number) {
  if (!(await hasVector()) || !(await aiFlags(viewer)).faces) return []
  const rows = await db.execute<{ id: string }>(sql`
    select f.node_id as id
    from faces f
    join people p on p.id = f.person_id and p.owner_id = ${viewer} and not p.hidden
    join nodes n on n.id = f.node_id and n.current_version_id = f.version_id
    left join file_versions v on v.id = n.current_version_id
    where f.owner_id = ${viewer} and n.owner_id = ${viewer} and n.trashed_at is null and n.vault_id is null
      and strpos(lower(p.name), lower(${q})) > 0
    group by f.node_id, v.taken_at, v.created_at
    order by coalesce(v.taken_at, v.created_at) desc limit ${limit}`)
  return rows.map((r) => r.id)
}
