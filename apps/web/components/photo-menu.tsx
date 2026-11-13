"use client"

import { Menu } from "@base-ui/react/menu"
import { DotsThreeIcon, ImagesIcon, InfoIcon, PencilSimpleLineIcon, UserPlusIcon } from "@phosphor-icons/react"

import { useAi } from "@/components/ai-context"
import { canEditImage } from "@/components/image-editor"
import { MENU_ITEM, MENU_POPUP } from "@/components/overlay-styles"
import { canEditItem } from "@/components/previewer"
import { Button } from "@/components/ui/button"
import { IMAGE, VIDEO } from "@/lib/file-rules"
import { cn } from "@/lib/utils"
import type { PhotoItem } from "@nimbus/shared/api"

// A photo's ⋯ in Photos, a person, an album or the viewer: Edit, Add to album, Add to person, Details.
// Only what fits the photo: my own for albums and people, editable images for Edit.
export function PhotoMenu({
  item,
  onEdit,
  onAlbum,
  onPerson,
  onDetails,
  className,
}: {
  item: PhotoItem
  onEdit: () => void
  onAlbum: () => void
  onPerson: () => void
  onDetails?: () => void
  className?: string
}) {
  const ai = useAi()
  const mine = item.role === undefined && !item.fromPartner && !item.shortcut
  const edit = canEditItem(item) && canEditImage(item.mime ?? null)
  const album = mine && (IMAGE.test(item.name) || VIDEO.test(item.name))
  const person = mine && IMAGE.test(item.name) && ai.faces && ai.facesOn
  if (!edit && !album && !person && !onDetails) return null
  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`More for ${item.name}`}
            onClick={(e) => e.stopPropagation()}
            className={className}
          />
        }
      >
        <DotsThreeIcon weight="bold" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-[70]">
          <Menu.Popup className={cn("w-52", MENU_POPUP)}>
            {edit && (
              <Menu.Item className={MENU_ITEM} onClick={onEdit}>
                <PencilSimpleLineIcon />
                Edit
              </Menu.Item>
            )}
            {album && (
              <Menu.Item className={MENU_ITEM} onClick={onAlbum}>
                <ImagesIcon />
                Add to album…
              </Menu.Item>
            )}
            {person && (
              <Menu.Item className={MENU_ITEM} onClick={onPerson}>
                <UserPlusIcon />
                Add to person…
              </Menu.Item>
            )}
            {onDetails && (
              <Menu.Item className={MENU_ITEM} onClick={onDetails}>
                <InfoIcon />
                Details
              </Menu.Item>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
