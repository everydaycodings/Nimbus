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
  "Admin" title and underline section tabs (Members, Settings); sections are `Card`s with `text-base` titles.
- Choices among a few options use bordered radio cards (`has-checked:border-ring/60 bg-input/30`); selects are native `<select>` styled like `Input`.
- Auth and status screens are a centered `Card` (`components/ui/card.tsx`).
- Lists are bordered `rounded-xl bg-card` containers with `divide-y` rows; roles use outline `Badge`.
- Tabs are the shadcn segmented style (`bg-muted p-[3px]`, active item `bg-input/30 border-input`).

## Shape and density
- Radius base `--radius: 0.625rem` (10px). Cards and containers `rounded-xl`, controls `rounded-md`.
- Focus is shadcn's `ring-[3px] ring-ring/50`.
- Tiles are outlined (`border-border`, transparent fill) rather than filled; selected tiles get a teal
  border with an 8% teal wash.
- Density is a user setting: `data-density="compact"` on a container shrinks `--row`
  (32px → 28px) and `--gap-ui` (12px → 8px). Use `h-row` / `gap-gap-ui`.

## Icon
A plain Mist teal cloud on a dark rounded tile (`app/icon.png`, `app/apple-icon.png`,
`app/favicon.ico`; source `public/icons/2-cloud.png`). In the UI the brand mark is the teal cloud
(`text-brand`) on a `bg-sidebar-accent` / `bg-muted` rounded tile.

## Browser surfaces
Text selection is tinted teal, the caret is teal, and scrollbars use `--muted` on a transparent track.

## Motion
Kept quiet. Motion only answers actions (open, expand, progress). No entrance animations.
Respect `prefers-reduced-motion`.
