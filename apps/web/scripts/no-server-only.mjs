// For running scripts outside Next: makes `import "server-only"` a no-op.
//   node --import ./scripts/no-server-only.mjs --import tsx --env-file=.env.local scripts/<script>.ts
import { register } from "node:module"

register(
  "data:text/javascript,export async function resolve(s, c, next) { return s === 'server-only' ? { url: 'data:text/javascript,', shortCircuit: true } : next(s, c) }"
)
