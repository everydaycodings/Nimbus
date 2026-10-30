"use client"

import { ContextMenu } from "@base-ui/react/context-menu"
import { PaletteIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react"

import { NavLink } from "@/components/nav-link"
import { MENU_ITEM, MENU_POPUP } from "@/components/overlay-styles"
import { useTagEditor } from "@/components/tag-edit"
import { TAG_DOT } from "@/lib/file-types"
import type { Tag } from "@/lib/files"
import { cn } from "@/lib/utils"

// The sidebar's Tags group: each opens /tags/[id]; right-click edits it.
export function SidebarTags({ tags, fade }: { tags: Tag[]; fade: string }) {
  const editor = useTagEditor(tags)
  return (
    <>
      {tags.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <p
            className={`flex h-8 items-center px-2 text-xs font-medium whitespace-nowrap text-muted-foreground ${fade}`}
          >
            Tags
          </p>
          {tags.map((tag) => (
            <ContextMenu.Root key={tag.id}>
              <ContextMenu.Trigger>
                <NavLink
                  href={`/tags/${tag.id}`}
                  label={tag.name}
                  icon={
                    <span className="grid size-4 shrink-0 place-items-center">
                      <span
                        className={cn(
                          "size-2.5 rounded-full",
                          TAG_DOT[tag.color]
                        )}
                      />
                    </span>
                  }
                />
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Positioner>
                  <ContextMenu.Popup className={`w-48 ${MENU_POPUP}`}>
                    <ContextMenu.Item
                      className={MENU_ITEM}
                      onClick={() => editor.edit(tag)}
                    >
                      <PencilSimpleIcon />
                      Rename…
                    </ContextMenu.Item>
                    <ContextMenu.Item
                      className={MENU_ITEM}
                      onClick={() => editor.edit(tag)}
                    >
                      <PaletteIcon />
                      Change color…
                    </ContextMenu.Item>
                    <ContextMenu.Separator className="-mx-1 my-1 h-px bg-border" />
                    <ContextMenu.Item
                      className={cn(
                        MENU_ITEM,
                        "text-destructive [&_svg]:text-destructive"
                      )}
                      onClick={() => editor.remove(tag)}
                    >
                      <TrashIcon />
                      Delete…
                    </ContextMenu.Item>
                  </ContextMenu.Popup>
                </ContextMenu.Positioner>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          ))}
        </div>
      )}
      {editor.dialogs}
    </>
  )
}
