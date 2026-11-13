import type { Hit, Item, SystemKind, Tag, TextPlace } from "@nimbus/shared/api"
import { formatBytes } from "@nimbus/shared/file-rules"
import { Image } from "expo-image"
import { ArrowCircleDown, ChatCircle, CheckCircle, Clock, DotsThreeVertical, Link, Star, UsersThree } from "phosphor-react-native"
import { memo, type ReactNode } from "react"
import { PixelRatio, Pressable, View } from "react-native"
import { useReducedMotion } from "react-native-reanimated"

import { FileIcon } from "@/components/file-icon"
import { Places, Snippet } from "@/components/search-places"
import { Text } from "@/components/ui"
import { useApi } from "@/lib/files"
import { systemLabel } from "@/lib/system-folders"
import { c, radius } from "@/lib/theme"

export type TileProps = {
  item: Item | Hit
  tags: Map<string, Tag>
  selected: boolean
  selecting: boolean
  compact: boolean
  // Kept on this phone; waiting for a connection to sync; a file that isn't saved while there's no connection.
  pinned?: boolean
  pending?: boolean
  dim?: boolean
  onPress: (item: Item) => void
  onLongPress: (item: Item) => void
  onMenu: (item: Item) => void
  // A search result: the words asked for, and a tap on one of the places they were found.
  q?: string
  onPlace?: (item: Item, place: TextPlace) => void
}

const SIZE_FONT = { fontVariant: ["tabular-nums" as const] }

function dateText(iso: string) {
  const d = new Date(iso)
  const year = d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" as const }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...year })
}

// Line 2: where it is for a search hit, else owner or date, then size for files.
function metaText(item: Item | Hit) {
  if ("where" in item) return item.where
  const when = item.owner ?? dateText(item.trashedAt ?? item.updatedAt)
  return item.kind === "file" ? `${when} · ${formatBytes(item.size)}` : when
}

function Thumb({ item, style }: { item: Item; style: object }) {
  const { account } = useApi()
  const still = useReducedMotion()
  return (
    <Image
      source={{
        uri: `${account.server}/api/files/${item.id}/thumb?v=${item.version}&r=${item.thumb}`,
        headers: { authorization: `Bearer ${account.token}` },
      }}
      style={style}
      contentFit="cover"
      cachePolicy="memory-disk"
      recyclingKey={item.id}
      transition={still ? 0 : 120}
      accessibilityIgnoresInvertColors
    />
  )
}

const hasThumb = (item: Item) => !!item.thumb && !!item.version

// Star, who it's shared with, tag dots: small, one line, after the text.
function Markers({ item, tags, pinned, pending }: { item: Item; tags: Map<string, Tag>; pinned?: boolean; pending?: boolean }) {
  const dots = item.tags.map((id) => tags.get(id)).filter((t): t is Tag => !!t)
  return (
    <>
      {pinned && <ArrowCircleDown size={14} weight="fill" color={c.brand} />}
      {pending && <Clock size={14} color={c.warning} />}
      {item.starred && <Star size={14} weight="fill" color={c.mutedForeground} />}
      {item.sharedWithPeople && <UsersThree size={14} color={c.mutedForeground} />}
      {item.hasLink && <Link size={14} color={c.mutedForeground} />}
      {!!item.comments && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }} accessible accessibilityLabel={`${item.comments} open comment thread${item.comments === 1 ? "" : "s"}`}>
          <ChatCircle size={14} color={c.mutedForeground} />
          <Text variant="caption" color={c.mutedForeground} style={{ fontVariant: ["tabular-nums"] }}>{item.comments}</Text>
        </View>
      )}
      {dots.slice(0, 5).map((t) => (
        <View key={t.id} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.tag[t.color] }} />
      ))}
    </>
  )
}

const Check = ({ on }: { on: boolean }) =>
  on ? <CheckCircle size={22} weight="fill" color={c.brand} /> : <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: c.mutedForeground }} />

function MenuButton({ item, onMenu }: { item: Item; onMenu: (item: Item) => void }) {
  return (
    <View style={{ borderRadius: 24, overflow: "hidden" }}>
      <Pressable
        onPress={() => onMenu(item)}
        android_ripple={{ color: c.ripple }}
        accessibilityRole="button"
        accessibilityLabel={`More actions for ${item.name}`}
        style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
      >
        <DotsThreeVertical size={22} weight="bold" color={c.mutedForeground} />
      </Pressable>
    </View>
  )
}

const kindWord = (item: Item) => (item.kind === "folder" ? "Folder" : "File")

// The outlined frame and press target shared by all three. Rounded clip wraps the Pressable
// so the ripple follows the corners.
function Frame({
  p,
  outlined = true,
  children,
}: {
  p: TileProps
  outlined?: boolean
  children: ReactNode
}) {
  const { item, selected, selecting } = p
  return (
    <View
      style={{
        // Tiles share a row's width; a list row is just full width.
        ...(outlined ? { flex: 1, minWidth: 0 } : {}),
        borderRadius: outlined ? radius.card : 0,
        overflow: "hidden",
        borderWidth: outlined ? 1 : 0,
        borderColor: selected ? c.brand : c.border,
        backgroundColor: selected ? c.brandWash : "transparent",
        opacity: p.dim ? 0.5 : 1,
      }}
    >
      <Pressable
        onPress={() => p.onPress(item)}
        onLongPress={() => p.onLongPress(item)}
        android_ripple={{ color: c.ripple }}
        accessibilityRole={selecting ? "checkbox" : "button"}
        accessibilityLabel={`${kindWord(item)}, ${item.name}${p.pinned ? ", available offline" : ""}${p.pending ? ", waiting to sync" : ""}${p.dim ? ", not available offline" : ""}`}
        accessibilityState={selecting ? { checked: selected } : { selected }}
      >
        {children}
      </Pressable>
    </View>
  )
}

function FolderTileImpl(p: TileProps) {
  const { item, tags, selecting, selected, compact, pinned, pending } = p
  return (
    <Frame p={p}>
      <View style={{ flexDirection: "row", alignItems: "center", minHeight: compact ? 48 : 56, paddingLeft: 12, paddingRight: selecting ? 12 : 0, gap: 8 }}>
        {selecting ? <Check on={selected} /> : <FileIcon item={item} size={24} />}
        {/* Markers get their own line: beside the name they'd squeeze it to nothing in a two-column tile. */}
        <View style={{ flex: 1, gap: 2 }}>
          {/* Two lines at large text, but only when they can break at a space: one long word would split mid-word. */}
          <Text variant="label" numberOfLines={PixelRatio.getFontScale() > 1.15 && /\s/.test(item.name) ? 2 : 1}>
            {item.name}
          </Text>
          {item.system && <SystemTag kind={item.system} />}
          {item.owner ? (
            <Meta item={item} tags={tags} text={item.owner} pinned={pinned} pending={pending} />
          ) : (
            (item.starred || item.sharedWithPeople || item.hasLink || !!item.comments || item.tags.length > 0 || pinned || pending) && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Markers item={item} tags={tags} pinned={pinned} pending={pending} />
              </View>
            )
          )}
        </View>
        {/* The button's empty padding overlaps the text column, so names get more room. */}
        {!selecting && (
          <View style={{ marginLeft: -12 }}>
            <MenuButton item={item} onMenu={p.onMenu} />
          </View>
        )}
      </View>
    </Frame>
  )
}
export const FolderTile = memo(FolderTileImpl)

function SystemTag({ kind }: { kind: SystemKind }) {
  return (
    <Text variant="caption" color={c.brand} numberOfLines={1} style={SIZE_FONT}>
      {systemLabel(kind)}
    </Text>
  )
}

function Meta({ item, tags, text, pinned, pending }: { item: Item; tags: Map<string, Tag>; text: string; pinned?: boolean; pending?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Text variant="caption" color={c.mutedForeground} numberOfLines={1} style={[SIZE_FONT, { flexShrink: 1 }]}>
        {text}
      </Text>
      <Markers item={item} tags={tags} pinned={pinned} pending={pending} />
    </View>
  )
}

function FileCardImpl(p: TileProps) {
  const { item, tags, selecting, selected, compact, pinned, pending, dim } = p
  return (
    <Frame p={p}>
      <View style={{ aspectRatio: 4 / 3, backgroundColor: c.card, alignItems: "center", justifyContent: "center" }}>
        {hasThumb(item) ? <Thumb item={item} style={{ width: "100%", height: "100%" }} /> : <FileIcon item={item} size={40} />}
      </View>
      <View style={{ paddingLeft: 12, paddingBottom: compact ? 6 : 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, paddingRight: selecting ? 12 : 0 }}>
          {selecting && <Check on={selected} />}
          <Text variant="label" numberOfLines={1} ellipsizeMode="middle" style={{ flex: 1 }}>
            {item.name}
          </Text>
          {!selecting && <MenuButton item={item} onMenu={p.onMenu} />}
        </View>
        <View style={{ marginTop: -8, paddingRight: 12 }}>
          <Meta item={item} tags={tags} text={dim ? "Not available offline" : metaText(item)} pinned={pinned} pending={pending} />
        </View>
      </View>
    </Frame>
  )
}
export const FileCard = memo(FileCardImpl)

function ListRowImpl(p: TileProps) {
  const { item, tags, selecting, selected, compact, pinned, pending, dim } = p
  const snippet = "snippet" in item ? item.snippet : null
  const inComment = "inComment" in item && !!item.inComment
  const places = "places" in item && item.places?.length && p.q && p.onPlace ? (item as Hit) : null
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: c.border }}>
      <Frame p={p} outlined={false}>
        <View style={{ flexDirection: "row", alignItems: "center", minHeight: compact ? 56 : 64, paddingLeft: 4, paddingRight: selecting ? 12 : 0, gap: 12 }}>
          {selecting && <Check on={selected} />}
          <View style={{ width: 40, height: 40, borderRadius: 8, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: hasThumb(item) ? c.card : undefined }}>
            {hasThumb(item) ? <Thumb item={item} style={{ width: 40, height: 40 }} /> : <FileIcon item={item} size={28} />}
          </View>
          <View style={{ flex: 1, minWidth: 0, paddingVertical: 8, gap: 2 }}>
            <Text variant="label" numberOfLines={1} ellipsizeMode="middle">
              {item.name}
            </Text>
            {item.system && <SystemTag kind={item.system} />}
            <Meta item={item} tags={tags} text={dim ? "Not available offline" : metaText(item)} pinned={pinned} pending={pending} />
            {places ? <Places hit={places} q={p.q!} onPlace={p.onPlace!} /> : snippet ? <Snippet text={snippet} prefix={inComment ? "In a comment: " : undefined} /> : null}
          </View>
          {!selecting && <MenuButton item={item} onMenu={p.onMenu} />}
        </View>
      </Frame>
    </View>
  )
}
export const ListRow = memo(ListRowImpl)
