import { withSecrets } from "@/lib/secrets/guard"
import { listProjects, policy } from "@/lib/secrets/service"
import { LOCK_CHOICES, methodsFor, unlockPolicy, unlockState } from "@/lib/secrets/unlock"

// Whether this session is unlocked and how it can unlock. Doesn't slide the idle
// clock unless `touch=1` (the web pings while someone is working).
export const GET = (req: Request) =>
  withSecrets(
    async (me) => {
      const touch = new URL(req.url).searchParams.get("touch") === "1"
      const st = await unlockState(touch)
      const m = await methodsFor(me)
      const pol = await policy()
      const { maxIdle } = await unlockPolicy()
      return Response.json({
        unlocked: Boolean(st?.unlocked),
        lockMinutes: m.lockMinutes,
        lockChoices: LOCK_CHOICES.filter((m) => !maxIdle || m <= maxIdle),
        methods: m.methods,
        hasPin: m.hasPin,
        projects: st?.unlocked ? await listProjects(me.id) : undefined,
        canCreateProject: pol.maxProjects,
      })
    },
    { open: true }
  )
