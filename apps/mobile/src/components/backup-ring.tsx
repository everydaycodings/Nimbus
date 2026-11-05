import type { ReactNode } from "react"
import { View } from "react-native"
import Svg, { Circle } from "react-native-svg"

import { useBackup } from "@/lib/backup"
import { describe, ringOf } from "@/lib/backup-rules"

// For the button the ring sits in, so TalkBack hears it as part of the account.
export function useBackupLabel(accountId: string) {
  const { settings, status } = useBackup()
  return ringOf(settings, status, accountId) ? `, camera backup: ${describe(status).title}` : ""
}
import { c } from "@/lib/theme"

const SIZE = 40
const STROKE = 2
const R = (SIZE - STROKE) / 2
const LENGTH = 2 * Math.PI * R

// The signature move: a thin ring round the avatar that is the backup's state. Teal fills while
// uploading and is whole when everything's backed up; red means it needs attention. No ring with backup off.
export function BackupRing({ accountId, children }: { accountId: string; children: ReactNode }) {
  const { settings, status } = useBackup()
  const ring = ringOf(settings, status, accountId)
  if (!ring) return <>{children}</>
  const color = ring.color === "destructive" ? c.destructive : c.brand
  return (
    <View importantForAccessibility="no-hide-descendants" style={{ width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center" }}>
      <Svg width={SIZE} height={SIZE} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
        {ring.progress < 1 && <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={c.mutedStrong} strokeWidth={STROKE} fill="none" />}
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          stroke={color}
          strokeWidth={STROKE}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${LENGTH} ${LENGTH}`}
          strokeDashoffset={LENGTH * (1 - ring.progress)}
        />
      </Svg>
      {children}
    </View>
  )
}
