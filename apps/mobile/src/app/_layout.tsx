import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold, useFonts } from "@expo-google-fonts/geist"
import { GeistMono_400Regular } from "@expo-google-fonts/geist-mono"
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query"
import { Stack } from "expo-router"
import * as SplashScreen from "expo-splash-screen"
import { StatusBar } from "expo-status-bar"
import { useEffect } from "react"
import { AppState } from "react-native"
import { GestureHandlerRootView } from "react-native-gesture-handler"

import { LockGate } from "@/components/lock"
import { OfflineWatcher } from "@/components/offline-bar"
import { SnackbarProvider } from "@/components/snackbar"
import { UploaderProvider } from "@/components/uploader"
import { VaultLockProvider } from "@/components/vault-lock"
import { TransferBar } from "@/lib/transfers"
import { AccountsProvider, useAccounts } from "@/lib/accounts"
import { ApiError } from "@/lib/api"
import { persistQueries, restoreQueries } from "@/lib/query-persist"
import { useShareIntake } from "@/lib/share-in"
import { c } from "@/lib/theme"

SplashScreen.preventAutoHideAsync()
const queries = new QueryClient({
  // No connection fails at once and keeps what's on screen; anything else gets one more try.
  defaultOptions: { queries: { staleTime: 15_000, retry: (n, e) => n < 1 && !(e instanceof ApiError && e.status === 0), networkMode: "always" } },
})
// Lists seen before are back before the first render, so a launch with no network opens into them.
restoreQueries(queries)
persistQueries(queries)
// React Native has no window focus: polling stops in the background, and what's stale refreshes on return.
focusManager.setEventListener((set) => {
  const sub = AppState.addEventListener("change", (s) => set(s === "active"))
  return () => sub.remove()
})

function Root() {
  const { ready } = useAccounts()
  const [fonts] = useFonts({ Geist_400Regular, Geist_500Medium, Geist_600SemiBold, GeistMono_400Regular })
  const loaded = ready && fonts
  useEffect(() => {
    if (loaded) SplashScreen.hideAsync()
  }, [loaded])
  if (!loaded) return null
  return (
    <LockGate>
      <SnackbarProvider>
        <UploaderProvider>
         <VaultLockProvider>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: c.background },
              animation: "fade_from_bottom",
            }}
          />
          <TransferBar />
          <ShareIntake />
          <OfflineWatcher />
         </VaultLockProvider>
        </UploaderProvider>
      </SnackbarProvider>
    </LockGate>
  )
}

function ShareIntake() {
  useShareIntake()
  return null
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.background }}>
      <StatusBar style="light" />
      <QueryClientProvider client={queries}>
        <AccountsProvider>
          <Root />
        </AccountsProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  )
}
