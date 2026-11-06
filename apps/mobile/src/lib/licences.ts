// The generated licence list (scripts/licences.mjs) and its search. Loaded on demand: it is a few hundred KB.
export type LicencePackage = { name: string; version: string; license: string; text: number }
export type LicenceData = { texts: string[]; packages: LicencePackage[] }

export const loadLicences = (): LicenceData => require("./licences.generated.json")

export function filterLicences(packages: LicencePackage[], query: string) {
  const q = query.trim().toLowerCase()
  return q ? packages.filter((p) => p.name.toLowerCase().includes(q) || p.license.toLowerCase().includes(q)) : packages
}
