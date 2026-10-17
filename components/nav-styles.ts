// Shared by links and the disabled "coming soon" rows so both collapse the same way.
export const NAV_ITEM =
  "relative flex h-row items-center gap-2 rounded-md px-2 text-sm whitespace-nowrap outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 group-data-[collapsed=true]/sidebar:w-8 [&_svg]:size-4 [&_svg]:shrink-0"
export const NAV_LABEL = "flex-1 truncate group-data-[collapsed=true]/sidebar:sr-only"

// Remembers the desktop rail state so the server renders the right width.
export const SIDEBAR_COOKIE = "sidebar_collapsed"

// File browser view preferences, remembered the same way.
export const LAYOUT_COOKIE = "files_layout"
export const DENSITY_COOKIE = "files_density"
