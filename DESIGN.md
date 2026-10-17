# Design

Direction **shadcn**, adopted 2026-10-18, replacing A. Calm. Stock shadcn/ui dark styling;
tokens live in `app/globals.css`.

## World
A professional, familiar tool that looks like the best of the shadcn ecosystem: neutral greys,
hairline borders, white primary buttons, an inset sidebar. Color goes only where it carries
meaning: the brand mark and focus ring (teal) and what kind of file something is (file-type hues).

## Theme
Dark only. `class="dark"` is pinned on `<html>` so shadcn `dark:` variants always apply; there
is no light theme and no toggle.

## Color
Stock shadcn `neutral` dark values (oklch, no hue).
| Token | Value | Use |
|---|---|---|
| `--background` | `oklch(0.145 0 0)` | Main content inset, auth page |
| `--card` / `--popover` / `--sidebar` | `oklch(0.205 0 0)` | Cards, menus, sidebar ground |
| `--muted` / `--accent` | `oklch(0.269 0 0)` | Hover, active nav item, icon tiles |
| `--border` / `--input` | white 10% / 15% | Hairlines / inputs and dashed empty states |
| `--foreground` | `oklch(0.985 0 0)` | Text |
| `--muted-foreground` | `oklch(0.708 0 0)` | Secondary text |
| `--primary` | `oklch(0.922 0 0)` | Primary buttons (near-white, dark text) |
| `--brand` / `--ring` | `#5fd0bb` Mist teal | Logo cloud, focus ring, selection, caret only |
| `--destructive` | `oklch(0.704 0.191 22.216)` | Delete, errors |

File types use their own hues via `--file-*` (`text-file-image`, `bg-file-folder/15`, …): folder `#f2c063`,
image `#f27fb2`, video `#b08cff`, doc `#6ea8ff`, pdf `#ff6f6f`, audio `#4fd1a5`, code `#ff9f66`,
archive `#b5b5b5`. These hues never appear on chrome.

Tags are user-chosen labels with their own `--tag-*` hues (red, orange, yellow, green, blue,
purple, gray; `TAG_DOT` in `lib/file-types.ts`), shown only as small dots: after an item's
name, in menus and on the Tags filter.

## Type
- **Geist** (`font-sans`) for everything; UI text is `text-sm`, page titles `text-2xl font-semibold tracking-tight`.
- **Geist Mono** (`font-mono`) only for data: file sizes, counts, paths, hashes, code previews.
- Sidebar group labels are `text-xs font-medium text-muted-foreground`, sentence case. No all-caps eyebrows.

## Layout
- App shell is shadcn's inset sidebar (`components/sidebar-shell.tsx`): `bg-sidebar` page, 16rem sidebar
  (brand tile, grouped nav, account menu in the footer), content in a `rounded-xl border shadow-sm bg-background`
  inset with a 48px header holding the sidebar toggle.
- From `md` up the sidebar collapses to a 3rem icon rail (toggle or Ctrl/Cmd+B, remembered in the
  `sidebar_collapsed` cookie). Collapsed items keep their label as `sr-only`, show a right-side tooltip, and the
  pending count shrinks to a dot. Collapse-aware styles key off `group-data-[collapsed=true]/sidebar`.
- Below `md` the sidebar is a left drawer (Base UI Dialog) opened from a sticky top bar with the brand;
  it closes on navigation. Page padding steps `p-4` / `sm:p-6` / `lg:p-10`.
- Account menu (`components/nav-user.tsx`): avatar, name, email; opens upward with an outline role `Badge` and Sign out.
- Admin lives under `/admin/*` (one sidebar link, active for every admin page). Its layout holds the
  "Admin" title and underline section tabs (Members, Settings, Email); sections are `Card`s with `text-base` titles.
- Choices among a few options use bordered radio cards (`has-checked:border-ring/60 bg-input/30`); selects are native `<select>` styled like `Input`.
- Auth and status screens are a centered `Card` (`components/ui/card.tsx`). Gate screens (`StatusScreen` in
  `app/(app)/layout.tsx`) hold their own way forward (a form or setup flow) above Sign out; `wide` for flows like two-factor.
- Every server-action submit is a `SubmitButton` (spinner and disabled while pending). Results show inline next to
  the button: a teal check plus muted text for success, `text-destructive` for errors. No toasts.
- A page-level status strip (icon tile + one bold line + one muted line in a `rounded-xl border bg-card` row) opens
  settings pages whose state matters more than their form, like `/admin/email`.
- Modals (Base UI Dialog, `bg-popover`, black/60 backdrop; classes in `components/overlay-styles.ts`)
  for destructive or show-once results (reset two-factor, temporary passwords, delete forever) and
  for short focused entry: new folder, rename, new tag, the move folder picker. Row overflow
  actions live behind a ghost `DotsThree` menu.
- Secrets: never echoed back. Stored ones show a dot placeholder and "Leave blank to keep it."; one-time values
  (backup codes, temporary passwords) sit in a mono `bg-input/20` box with Copy.
- Lists are bordered `rounded-xl bg-card` containers with `divide-y` rows; roles use outline `Badge`.
- Tabs are the shadcn segmented style (`bg-muted p-[3px]`, active item `bg-input/30 border-input`).

## File browser
`components/file-browser.tsx` drives every file view (My files, folders, Recent, Starred, Shared, Trash).
- Header: page title, or a breadcrumb at title size whose ancestors are links and drop targets.
  Actions on the right: New folder (primary), Select, then segmented Layout (list/grid),
  Tile size (small/medium/large, grid only) and Density controls.
- Below it, one row: filter pills (Type, Modified, Size, Tags) and a summary on the left, the
  action notice and the Sort pill on the right. In selection mode the pills give way to the
  selection bar (count, Select all, ghost action buttons).
- Pills are `rounded-full` with a leading icon. A filter that is on shows its value and icon,
  an `border-brand/40 bg-brand/10` tint and an inline × to clear it. Menu options carry
  file-type icons, tag dots or size bars.
- Grid: "Folders" then "Files" sections. Folder tiles are one row (icon, name, date · size);
  file cards add a `bg-muted/40` 4:3 preview well (the type icon until thumbnails exist) and a
  date · size line. List: `bg-card` table with sortable column headers.
- A click highlights one item (teal border and 8% teal wash); double-click opens. Checkboxes
  replace the leading icon on hover and everywhere in selection mode.
- Action results (moved, trashed with Undo, errors) show inline in the notice slot, never as toasts.
- Details is a right-hand sheet (Base UI Dialog sliding from the right) with a `dl` of facts.
- Destructive menu actions (Move to trash, Delete forever, Delete version) are `text-destructive`
  everywhere they appear: ⋯ menu, right-click menu and selection bar.
- Sizes use `tabular-nums` in the sans face, not mono, so "9 B" doesn't split from its unit.

## Uploads, versions, storage
- The sidebar opens with a primary **New** button (menu: New folder, File upload, Folder upload).
- Uploads show in a Drive-style panel pinned bottom-right (`components/upload-panel.tsx`): a
  header with "Uploading N of M · ETA" and pause/resume all, rows with a thin teal progress bar.
  It collapses, and clears itself ~5 s after everything succeeds unless hovered or focused.
- Dropping OS files shows a full-area dashed teal overlay naming the destination folder.
- Same-name conflicts ask in a dialog, one at a time, with an Apply to all checkbox.
- The Versions dialog (`components/versions-dialog.tsx`, `max-w-xl`) lists rows of version
  number, date, Current badge, a pin when kept forever, size · uploader and the note. Make current
  and Download are inline; the rest sit in a per-row ⋯ menu.
- The storage meter sits above the account menu in the sidebar footer: "Storage" and used / quota,
  a 6px bar split by file-type hues (`--file-image`, `--file-video`, `--file-doc`,
  `--file-archive` for Other) plus a hatched segment for versions & trash, and a dot legend.
  The total turns `text-destructive` at 90%.
- Base UI positioners share the dialogs' `z-50` layer (one rule in `globals.css`), so menus
  opened inside dialogs land on top.

## Thumbnails and previews
- Grid file cards fill their 4:3 well with a thumbnail (`components/thumb.tsx`), cover-cropped;
  pages and code anchor to the top. Thumbnails are 480px WebP drawn in the browser; text ones
  use shiki's `github-dark-default` colors.
- Opening a file shows the previewer (`components/previewer.tsx`): a full-screen `black/95`
  overlay, a 56px top bar (close, type icon, name, `vN` chip for older versions, "3 of 12",
  download, details, ⋯) and round outline prev/next buttons at the sides.
- Code, text and Markdown sit in a bordered `bg-background` panel with a 44px toolbar
  (Preview/Source segmented toggle, line count, Wrap, Copy); code has muted line numbers.
  CSV and spreadsheets are sticky-header tables with row numbers; sheets switch by a
  segmented tab strip below.
- Video uses Nimbus's own player (`components/video-player.tsx`): fitted to the video's shape
  on a black `rounded-xl` stage, a centered frosted play button while paused, and a bottom
  scrim holding a teal seek bar (buffered in white/35, hover time readout), play, volume,
  time, speed menu, picture-in-picture and fullscreen. Controls fade after 2.5 s of playback.
- Owners change a thumbnail from the ⋯ menu ("Change thumbnail…" picks an image, "Reset
  thumbnail" goes back to automatic) or with the player's "Use this frame" button. Thumbnail
  URLs carry a revision (`?r=`), so they cache forever and change when replaced.

## Shape and density
- Radius base `--radius: 0.625rem` (10px). Cards and containers `rounded-xl`, controls `rounded-md`.
- Focus is shadcn's `ring-[3px] ring-ring/50`.
- Tiles are outlined (`border-border`, transparent fill) rather than filled; selected tiles get a teal
  border with an 8% teal wash.
- Density is a user setting: `data-density="compact"` on a container shrinks `--row`
  (32px → 28px), `--gap-ui` (12px → 8px), `--file-row` (44px → 36px) and `--tile`
  (11rem → 9rem, the grid's minimum tile width). Use `h-row`, `gap-gap-ui`, `h-file-row`.
  `data-tiles="small|large"` overrides `--tile` with 8rem / 13rem; medium keeps the density's.

## Icon
A plain Mist teal cloud on a dark rounded tile (`app/icon.png`, `app/apple-icon.png`,
`app/favicon.ico`; source `public/icons/2-cloud.png`). In the UI the brand mark is the teal cloud
(`text-brand`) on a `bg-sidebar-accent` / `bg-muted` rounded tile.

## Browser surfaces
Text selection is tinted teal, the caret is teal, and scrollbars use `--muted` on a transparent track.

## Motion
Kept quiet. Motion only answers actions (open, expand, progress). No entrance animations.
Respect `prefers-reduced-motion`.
