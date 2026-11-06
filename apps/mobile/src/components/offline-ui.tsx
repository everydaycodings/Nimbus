import type { Item } from "@nimbus/shared/api"

import { ConfirmDialog } from "@/components/dialog"
import { useOfflineActions, type CapAsk } from "@/lib/offline-hooks"

// Marking past the cap asks first.
export function CapDialog({ ask, onClose }: { ask: CapAsk; onClose: () => void }) {
  const offline = useOfflineActions()
  return (
    <ConfirmDialog
      title="Over your offline limit?"
      body={offline.message(ask)}
      confirm="Save anyway"
      danger={false}
      onClose={onClose}
      onConfirm={() => void offline.set(ask.items as Item[], true, true)}
    />
  )
}
