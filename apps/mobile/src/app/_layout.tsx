import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold, useFonts } from "@expo-google-fonts/geist"
import { GeistMono_400Regular } from "@expo-google-fonts/geist-mono"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Stack } from "expo-router"
import * as SplashScreen from "expo-splash-screen"
import { StatusBar } from "expo-status-bar"
import { useEffect } from "react"
import { GestureHandlerRootView } from "react-native-gesture-handler"

import { LockGate } from "@/components/lock"
import { SnackbarProvider } from "@/components/snackbar"
import { TransferBar } from "@/lib/transfers"
import { AccountsProvider, useAccounts } from "@/lib/accounts"
import { c } from "@/lib/theme"

SplashScreen.preventAutoHideAsync()
const queries = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1 } },
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
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: c.background },
            animation: "fade_from_bottom",
          }}
        />
        <TransferBar />
      </SnackbarProvider>
    </LockGate>
  )
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
