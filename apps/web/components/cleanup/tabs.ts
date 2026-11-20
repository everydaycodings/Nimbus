export const TABS = [
  ["duplicates", "Duplicates"],
  ["similar", "Similar photos"],
  ["largest", "Largest"],
  ["unopened", "Not opened"],
] as const
export type Tab = (typeof TABS)[number][0]
