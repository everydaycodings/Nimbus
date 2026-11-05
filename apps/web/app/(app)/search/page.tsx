import { FileBrowser } from "@/components/file-browser"
import { listTags, pageUserId, searchItems, viewPrefs } from "@/lib/files"

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  return { title: `${q ? `${q} · ` : ""}Search · Nimbus` }
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const me = await pageUserId()
  const q =
    typeof (await searchParams).q === "string"
      ? (await searchParams).q!.trim()
      : ""
  const [items, prefs, tags] = await Promise.all([
    searchItems(me, q),
    viewPrefs(),
    listTags(me),
  ])

  return (
    <FileBrowser
      key={q}
      view="search"
      title={q ? `Results for “${q}”` : "Search"}
      items={items}
      empty={
        q
          ? {
              title: "No matches",
              body: "Nothing you own or that's shared with you has that in its name or text. Check the spelling, or try fewer words. Trash isn't searched.",
            }
          : {
              title: "Search your files",
              body: "Press Ctrl+K or use the search box above to find files by name or by the text inside them.",
            }
      }
      tags={tags}
      {...prefs}
    />
  )
}
