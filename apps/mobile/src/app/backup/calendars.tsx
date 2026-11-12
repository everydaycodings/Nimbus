import { useEffect, useState } from "react"
import { View } from "react-native"

import { Group, Page, Section, SwitchRow } from "@/components/page"
import { Spinner, Text } from "@/components/ui"
import { listCalendars, usePhoneBackup } from "@/lib/phone-backup"
import { chosenCalendars, type PhoneCalendar } from "@/lib/phone-backup-rules"
import { c } from "@/lib/theme"

export default function Calendars() {
  const { settings, change } = usePhoneBackup()
  const [all, setAll] = useState<PhoneCalendar[] | null>(null)
  useEffect(() => {
    listCalendars().then(setAll, () => setAll([]))
  }, [])
  const chosen = all ? chosenCalendars(settings, all) : []
  return (
    <Page title="Calendars">
      <Section note="Calendars that only live on this phone are ticked to start with. Calendars from an account, like Google, are already kept by that account.">
        {!all ? (
          <View style={{ height: 120 }}><Spinner /></View>
        ) : all.length === 0 ? (
          <Text color={c.mutedForeground}>No calendars on this phone.</Text>
        ) : (
          <Group>
            {all.map((cal) => (
              <SwitchRow
                key={cal.id}
                label={cal.title}
                detail={cal.account || undefined}
                value={chosen.includes(cal.id)}
                onChange={(on) => change({ calendars: on ? [...chosen, cal.id] : chosen.filter((x) => x !== cal.id) })}
              />
            ))}
          </Group>
        )}
      </Section>
    </Page>
  )
}
