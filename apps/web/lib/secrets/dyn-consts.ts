// What the browser and the server both need for dynamic credentials (no Node imports).
export const ENGINES = ["postgres", "mysql", "redis", "mongodb"] as const
export type Engine = (typeof ENGINES)[number]
export const ENGINE_LABEL: Record<Engine, string> = { postgres: "PostgreSQL", mysql: "MySQL / MariaDB", redis: "Redis (ACL)", mongodb: "MongoDB" }
export const DEFAULT_PORT: Record<Engine, number> = { postgres: 5432, mysql: 3306, redis: 6379, mongodb: 27017 }

// {{expiry}} is the hard limit (issue time plus the connection's max TTL), so a
// renewed lease still sits inside what the database was told. Nimbus revokes at
// the lease's own expiry.
export const DEFAULT_TEMPLATE: Record<Engine, { create: string; revoke: string }> = {
  postgres: {
    create: `CREATE ROLE "{{username}}" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiry}}';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO "{{username}}";`,
    revoke: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '{{username}}';
DROP OWNED BY "{{username}}";
DROP ROLE IF EXISTS "{{username}}";`,
  },
  mysql: {
    create: `CREATE USER '{{username}}'@'%' IDENTIFIED BY '{{password}}';
GRANT SELECT ON *.* TO '{{username}}'@'%';`,
    revoke: `DROP USER IF EXISTS '{{username}}'@'%';`,
  },
  redis: {
    create: `ACL SETUSER {{username}} on >{{password}} ~* &* +@read`,
    revoke: `ACL DELUSER {{username}}`,
  },
  mongodb: {
    create: `{"createUser":"{{username}}","pwd":"{{password}}","roles":[{"role":"readAnyDatabase","db":"admin"}]}`,
    revoke: `{"dropUser":"{{username}}"}`,
  },
}

export function fmtTtl(s: number) {
  if (s % 86400 === 0) return `${s / 86400}d`
  if (s % 3600 === 0) return `${s / 3600}h`
  if (s % 60 === 0) return `${s / 60}m`
  return `${s}s`
}
