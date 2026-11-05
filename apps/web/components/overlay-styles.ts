// Menus and modals share one look. Width is left to each use.
export const MENU_POPUP =
  "max-h-(--available-height) origin-(--transform-origin) overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md transition-[opacity,scale] duration-100 outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"

export const MENU_ITEM =
  "flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none select-none data-highlighted:bg-accent [&_svg]:size-4 [&_svg]:text-muted-foreground"

export const DIALOG_BACKDROP =
  "fixed inset-0 z-50 bg-black/60 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0"

export const DIALOG_POPUP =
  "fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border bg-popover p-6 text-popover-foreground shadow-lg transition-[opacity,scale] duration-150 outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"
