import { router, useLocalSearchParams } from "expo-router"
import { use, useEffect, useRef } from "react"

import { LockedContext } from "@/components/lock"
import { useSnack } from "@/components/snackbar"
import { Spinner } from "@/components/ui"
import { useUploader } from "@/components/uploader"
import { useAccounts } from "@/lib/accounts"
import { errorText } from "@/lib/api"
import { native } from "@/lib/native"
import { offerFiles } from "@/lib/share-in"
import type { Entry } from "@/lib/upload-plan"
import { pick } from "@/lib/uploads"

// Where app shortcuts, widgets and the Quick Settings tile land: nimbus://quick?do=upload|scan|photo|search|backup|home.
// Files home goes underneath, so Back returns to it. Picked files go to Save to for a folder.
export default function Quick() {
  const { do: action } = useLocalSearchParams<{ do?: string }>()
  const { active, ready } = useAccounts()
  const locked = use(LockedContext)
  const { scan } = useUploader()
  const snack = useSnack()
  const started = useRef(false)

  useEffect(() => {
    // After the app lock: a picker shouldn't open over it.
    if (!ready || locked || started.current) return
    started.current = true
    if (!active) return void router.replace("/")
    router.replace("/home")
    if (action === "search") return void router.push("/search")
    if (action === "backup") return void router.push("/backup")
    ;(async () => {
      let entries: Entry[] | null = []
      try {
        if (action === "upload") entries = await pick.files()
        else if (action === "photo") entries = await pick.camera("images")
        else if (action === "scan") {
          if (!(await native?.scanAvailable())) return snack({ text: "Scanning needs Google Play services, which this phone doesn't have.", error: true })
          entries = await scan()
        }
      } catch (e) {
        return snack({ text: errorText(e), error: true })
      }
      if (entries === null) return snack({ text: "Nimbus needs camera access for that. You can allow it in Android's settings.", error: true })
      const files = entries.filter((e) => e.uri).map((e) => ({ uri: e.uri!, name: e.path, size: e.size, mime: e.mime ?? "" }))
      if (files.length) offerFiles(files, false)
    })()
  }, [ready, locked, active, action, scan, snack])

  return <Spinner />
}
