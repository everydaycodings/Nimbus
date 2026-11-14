// TLS to the databases, with and without the connection's own CA. Needs throwaway TLS containers
// whose server certificate is signed by $TLS_DIR/ca.pem (SAN localhost, 127.0.0.1):
//   DYN_TLS=1 TLS_DIR=/path node --test dyn-tls.int.test.ts
// (pg 54420, mysql 33420 with require_secure_transport, redis 63420 --tls-port, mongo 27420 requireTLS; password adminpw)
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { ping, type Target } from "./dyn-drivers.ts"

const on = process.env.DYN_TLS === "1"
const ca = on ? readFileSync(`${process.env.TLS_DIR}/ca.pem`, "utf8") : ""
const T: Record<string, Target> = {
  postgres: { engine: "postgres", host: "127.0.0.1", port: 54420, database: "postgres", tls: true, username: "postgres", password: "adminpw" },
  mysql: { engine: "mysql", host: "127.0.0.1", port: 33420, database: "app", tls: true, username: "root", password: "adminpw" },
  redis: { engine: "redis", host: "127.0.0.1", port: 63420, database: "", tls: true, username: "", password: "adminpw" },
  mongodb: { engine: "mongodb", host: "127.0.0.1", port: 27420, database: "admin", tls: true, username: "root", password: "adminpw" },
}

for (const [engine, t] of Object.entries(T)) {
  test(`${engine}: private-CA server fails with a clear message, works with the CA, and a wrong name is named`, { skip: !on }, async () => {
    await assert.rejects(ping(t), /isn't trusted[\s\S]*CA certificate/)
    assert.match(await ping({ ...t, ca }), /./)
    // mysql2 can't name-check an IP host; the pinned CA still protects it.
    if (engine !== "mysql") await assert.rejects(ping({ ...t, ca, host: "127.0.0.2" }), /doesn't match the host/)
    const other = readFileSync(`${process.env.TLS_DIR}/server.pem`, "utf8") // a leaf, not the signing CA
    await assert.rejects(ping({ ...t, ca: other }), /isn't trusted|doesn't match/)
  })
}
