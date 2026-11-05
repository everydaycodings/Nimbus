import type { Hit, Item, Tag } from "@nimbus/shared/api"
import { formatBytes } from "@nimbus/shared/file-rules"
import { Image } from "expo-image"
import { CheckCircle, DotsThreeVertical, Link, Star, UsersThree } from "phosphor-react-native"
import { memo, type ReactNode } from "react"
import { PixelRatio, Pressable, View } from "react-native"
import { useReducedMotion } from "react-native-reanimated"

import { FileIcon } from "@/components/file-icon"
import { Text } from "@/components/ui"
import { useApi } from "@/lib/files"
import { c, radius } from "@/lib/theme"

export type TileProps = {
  item: Item | Hit
  tags: Map<string, Tag>
  selected: boolean
  selecting: boolean
  compact: boolean
  onPress: (item: Item) => void
  onLongPress: (item: Item) => void
  onMenu: (item: Item) => void
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
function Markers({ item, tags }: { item: Item; tags: Map<string, Tag> }) {
  const dots = item.tags.map((id) => tags.get(id)).filter((t): t is Tag => !!t)
  return (
    <>
      {item.starred && <Star size={14} weight="fill" color={c.mutedForeground} />}
      {item.sharedWithPeople && <UsersThree size={14} color={c.mutedForeground} />}
      {item.hasLink && <Link size={14} color={c.mutedForeground} />}
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
      }}
    >
      <Pressable
        onPress={() => p.onPress(item)}
        onLongPress={() => p.onLongPress(item)}
        android_ripple={{ color: c.ripple }}
        accessibilityRole={selecting ? "checkbox" : "button"}
        accessibilityLabel={`${kindWord(item)}, ${item.name}`}
        accessibilityState={selecting ? { checked: selected } : { selected }}
      >
        {children}
      </Pressable>
    </View>
  )
}

function FolderTileImpl(p: TileProps) {
  const { item, tags, selecting, selected, compact } = p
  return (
    <Frame p={p}>
      <View style={{ flexDirection: "row", alignItems: "center", minHeight: compact ? 48 : 56, paddingLeft: 12, paddingRight: selecting ? 12 : 0, gap: 8 }}>
        {selecting ? <Check on={selected} /> : <FileIcon item={item} size={24} />}
        {/* Markers get their own line: beside the name they'd squeeze it to nothing in a two-column tile. */}
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" numberOfLines={PixelRatio.getFontScale() > 1.15 ? 2 : 1}>
            {item.name}
          </Text>
          {item.owner ? (
            <Meta item={item} tags={tags} text={item.owner} />
          ) : (
            (item.starred || item.sharedWithPeople || item.hasLink || item.tags.length > 0) && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Markers item={item} tags={tags} />
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

function Meta({ item, tags, text }: { item: Item; tags: Map<string, Tag>; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Text variant="caption" color={c.mutedForeground} numberOfLines={1} style={[SIZE_FONT, { flexShrink: 1 }]}>
        {text}
      </Text>
      <Markers item={item} tags={tags} />
    </View>
  )
}

function FileCardImpl(p: TileProps) {
  const { item, tags, selecting, selected, compact } = p
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
          <Meta item={item} tags={tags} text={metaText(item)} />
        </View>
      </View>
    </Frame>
  )
}
export const FileCard = memo(FileCardImpl)

// \u0001 and \u0002 wrap the matched words in a snippet.
function Snippet({ text }: { text: string }) {
  const [first, ...rest] = text.split("\u0001")
  return (
    <Text variant="caption" color={c.mutedForeground} numberOfLines={2}>
      {first}
      {rest.map((part, i) => {
        const [hit, tail] = part.split("\u0002")
        return (
          <Text key={i} variant="caption" color={c.mutedForeground}>
            <Text variant="caption" color={c.foreground} style={{ fontFamily: "Geist_600SemiBold" }}>
              {hit}
            </Text>
            {tail}
          </Text>
        )
      })}
    </Text>
  )
}

function ListRowImpl(p: TileProps) {
  const { item, tags, selecting, selected, compact } = p
  const snippet = "snippet" in item ? item.snippet : null
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
            <Meta item={item} tags={tags} text={metaText(item)} />
            {snippet ? <Snippet text={snippet} /> : null}
          </View>
          {!selecting && <MenuButton item={item} onMenu={p.onMenu} />}
        </View>
      </Frame>
    </View>
  )
}
export const ListRow = memo(ListRowImpl)
