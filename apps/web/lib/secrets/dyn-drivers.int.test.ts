// Needs the four throwaway containers (see the S6a notes): DYN_INT=1 node --test dyn-drivers.int.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { endSessions, execute, ping, setPassword, userExists, type Target } from "./dyn-drivers.ts"
import { DEFAULT_TEMPLATE, newPassword, newUsername, render, type Engine } from "./dyn-rules.ts"

const on = process.env.DYN_INT === "1"
const ADMIN: Record<Engine, Target> = {
  postgres: { engine: "postgres", host: "127.0.0.1", port: 54410, database: "postgres", tls: false, username: "postgres", password: "adminpw" },
  mysql: { engine: "mysql", host: "127.0.0.1", port: 33410, database: "app", tls: false, username: "root", password: "adminpw" },
  redis: { engine: "redis", host: "127.0.0.1", port: 63410, database: "", tls: false, username: "", password: "adminpw" },
  mongodb: { engine: "mongodb", host: "127.0.0.1", port: 27410, database: "admin", tls: false, username: "root", password: "adminpw" },
}
const login = (a: Target, username: string, password: string) => ping({ ...a, username, password })
const works = (a: Target, u: string, p: string) => login(a, u, p).then(() => true, () => false)
const exp = () => new Date(Date.now() + 3600_000).toISOString().replace(/\.\d+Z$/, "Z")

for (const engine of Object.keys(ADMIN_KEYS()) as Engine[]) {
  test(`${engine}: lease user logs in, revoke locks it out`, { skip: !on }, async () => {
    const a = ADMIN[engine]
    await ping(a)
    const username = newUsername()
    const password = newPassword()
    await execute(a, render(DEFAULT_TEMPLATE[engine].create, { username, password, expiry: exp() }))
    assert.ok(await userExists(a, username))
    assert.ok(await works(a, username, password), "lease login")
    assert.ok(!(await works(a, username, "wrong")), "wrong password")
    await execute(a, render(DEFAULT_TEMPLATE[engine].revoke, { username }))
    await endSessions(a, username)
    assert.ok(!(await userExists(a, username)))
    assert.ok(!(await works(a, username, password)), "after revoke")
  })

  test(`${engine}: rotation changes the password, old fails and new works`, { skip: !on }, async () => {
    const a = ADMIN[engine]
    const username = `app_${engine}`
    const old = newPassword()
    await execute(a, render(DEFAULT_TEMPLATE[engine].revoke, { username })).catch(() => {})
    await execute(a, render(DEFAULT_TEMPLATE[engine].create, { username, password: old, expiry: exp() }))
    assert.ok(await works(a, username, old))
    const next = newPassword()
    await setPassword(a, username, next)
    assert.ok(!(await works(a, username, old)), "old password after rotation")
    assert.ok(await works(a, username, next), "new password")
    await assert.rejects(setPassword(a, "ghost_user", next), /no user/)
    await execute(a, render(DEFAULT_TEMPLATE[engine].revoke, { username }))
  })
}

function ADMIN_KEYS() {
  return ADMIN
}
