// The server API versions this app can talk to, and what to say when a server is outside them.
export const API_MIN = 1
export const API_MAX = 1

export const oldAppText = (server?: number) =>
  `This server speaks API ${server ?? "a newer version"}; this app understands up to ${API_MAX}. Get the update to keep using it.`
export const oldServerText = (server?: number) =>
  `This app needs a newer Nimbus on the server (API ${API_MIN} or later${server === undefined ? "" : `; it has ${server}`}). Ask whoever runs it to update.`

export type VersionProblem = "old-app" | "old-server"

export const versionProblem = (apiVersion: number): VersionProblem | null =>
  apiVersion > API_MAX ? "old-app" : apiVersion < API_MIN ? "old-server" : null
