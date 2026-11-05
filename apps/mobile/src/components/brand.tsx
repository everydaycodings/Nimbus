import { View } from "react-native"
import Svg, { Path } from "react-native-svg"

import { c } from "@/lib/theme"

// The plain cloud from the Nimbus icon (apps/web/public/icons/2-cloud.png).
const CLOUD = "M7 18a4.5 4.5 0 0 1-.42-8.98 5.5 5.5 0 0 1 10.84 0A4.5 4.5 0 0 1 17 18z"

export const BrandMark = ({ size = 56 }: { size?: number }) => (
  <View
    accessibilityLabel="Nimbus"
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.27,
      backgroundColor: c.muted,
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <Svg width={size * 0.68} height={size * 0.68} viewBox="0 0 24 24">
      <Path d={CLOUD} fill={c.brand} />
    </Svg>
  </View>
)
