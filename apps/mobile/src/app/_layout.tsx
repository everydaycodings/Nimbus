import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold, useFonts } from "@expo-google-fonts/geist"
import { GeistMono_400Regular } from "@expo-google-fonts/geist-mono"
import { QueryCache, QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query"
import { ErrorBoundary as DefaultErrorBoundary, Stack, type ErrorBoundaryProps } from "expo-router"
import * as SplashScreen from "expo-splash-screen"
import { StatusBar } from "expo-status-bar"
import { useEffect } from "react"
import { AppState } from "react-native"
import { GestureHandlerRootView } from "react-native-gesture-handler"

import { LockGate } from "@/components/lock"
import { OfflineWatcher } from "@/components/offline-bar"
import { PushWatcher } from "@/components/push-watcher"
import { ServerGate } from "@/components/server-gate"
import { SnackbarProvider } from "@/components/snackbar"
import { UploaderProvider } from "@/components/uploader"
import { VaultLockProvider } from "@/components/vault-lock"
import { TransferBar } from "@/lib/transfers"
import { AccountsProvider, useAccounts } from "@/lib/accounts"
import { ApiError } from "@/lib/api"
import { logError } from "@/lib/error-log"
import { persistQueries, restoreQueries } from "@/lib/query-persist"
import { useShareIntake } from "@/lib/share-in"
import { c } from "@/lib/theme"

SplashScreen.preventAutoHideAsync()
const queries = new QueryClient({
  queryCache: new QueryCache({ onError: (e) => logError("query", e) }),
  // No connection fails at once and keeps what's on screen; anything else gets one more try.
  defaultOptions: { queries: { staleTime: 15_000, retry: (n, e) => n < 1 && !(e instanceof ApiError && e.status === 0), networkMode: "always" } },
})
// Crashes and screen errors go in the diagnostics log, then carry on as before.
const previousHandler = ErrorUtils.getGlobalHandler()
ErrorUtils.setGlobalHandler((e, fatal) => {
  logError(fatal ? "fatal" : "js", e)
  previousHandler(e, fatal)
})
export function ErrorBoundary(props: ErrorBoundaryProps) {
  useEffect(() => logError("screen", props.error), [props.error])
  return <DefaultErrorBoundary {...props} />
}
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
          <PushWatcher />
          <ServerGate />
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
