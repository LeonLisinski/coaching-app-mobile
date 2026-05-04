import * as Linking from 'expo-linking'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import { Stack, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Platform, Text, View } from 'react-native'
import { supabase } from '@/lib/supabase'
import { LanguageProvider } from '@/lib/LanguageContext'
import { ClientProvider } from '@/lib/ClientContext'
import { Session } from '@supabase/supabase-js'
// dist/main = CommonJS build, safe for Metro/React Native bundler
import { STORAGE_KEY as SUPABASE_STORAGE_KEY } from '@supabase/auth-js/dist/main/lib/constants'
import { setStartupSession } from '@/lib/startupAuth'

export default function RootLayout() {
  const router = useRouter()
  const [, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const notifListener = useRef<Notifications.EventSubscription | null>(null)
  const responseListener = useRef<Notifications.EventSubscription | null>(null)

  useEffect(() => {
    let mounted = true
    let aborted = false

    // ── Cold-start session check ──────────────────────────────────────────────
    // WHY we read SecureStore directly instead of calling supabase.auth.getSession():
    //
    // supabase-js v2's getSession() always awaits `initializePromise` before
    // returning. initializePromise runs _recoverAndRefresh() which — when the
    // access token is expired or near-expiry — makes a network request to
    // refresh it. On Android cold-start the first network round-trip can take
    // 8-30 s (network stack waking up, slow cell data, etc.). This blocked the
    // loading screen for the full duration and then left index.tsx hanging too.
    //
    // The fix: read the session JSON directly from SecureStore. It is a pure
    // local read (< 100 ms) with no network dependency. We use the same key
    // that supabase-js uses internally (imported from auth-js constants so it
    // stays in sync automatically). supabase-js still runs _recoverAndRefresh()
    // in the background; by the time runInit() in (tabs)/_layout.tsx calls
    // getSession() the token is usually already refreshed.
    //
    // Web fallback: on web, supabase-js uses localStorage (not SecureStore), so
    // we fall back to getSession() there — web cold-start does not have the
    // same Android network-wakeup issue.
    const startupTimeout = setTimeout(() => {
      if (!mounted || aborted) return
      aborted = true
      console.warn('[startup] storage read timed out — forcing loading=false')
      setStartupSession(false)  // tell index.tsx: no session found
      setSession(null)
      setLoading(false)
    }, 5000)

    ;(async () => {
      try {
        let session: Session | null = null

        if (Platform.OS !== 'web') {
          const raw = await SecureStore.getItemAsync(SUPABASE_STORAGE_KEY)
          if (raw) {
            try {
              const parsed = JSON.parse(raw)
              if (parsed?.access_token && parsed?.user) session = parsed as Session
            } catch { /* corrupt stored data — treat as no session */ }
          }
        } else {
          const { data } = await supabase.auth.getSession()
          session = data.session
        }

        if (!mounted || aborted) return
        clearTimeout(startupTimeout)
        aborted = true

        // Cache the result for index.tsx — eliminates a second SecureStore
        // read on the same key which can deadlock on Android if supabase-js
        // is concurrently writing (after a background token refresh).
        setStartupSession(!!(session))
        setSession(session)
        setLoading(false)
      } catch (e) {
        if (!mounted) return
        clearTimeout(startupTimeout)
        console.error('[startup CATCH]', { rawMsg: (e as Error)?.message, error: e })
        setStartupSession(false)
        setSession(null)
        setLoading(false)
      }
    })()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)

      // Redirect to login when session is invalidated (expired token, remote sign-out, etc.)
      if (event === 'SIGNED_OUT' || (!session && event === 'TOKEN_REFRESHED')) {
        router.replace('/(auth)/login')
        return
      }

    })

    // ── Deep link handler: password reset & invite links ──────────────────────
    // Supabase auth emails contain: unitlift://set-password#access_token=...&type=recovery
    // or unitlift://set-password#access_token=...&type=invite
    const handleDeepLink = async (url: string) => {
      if (!url.includes('set-password') && !url.includes('access_token')) return

      // Extract the fragment (hash) part of the URL and parse it as query params
      const hash = url.split('#')[1] ?? url.split('?')[1] ?? ''
      const params = Object.fromEntries(hash.split('&').map(p => p.split('=')))

      const { access_token, refresh_token, type } = params
      if (!access_token || !refresh_token) return

      if (type === 'recovery' || type === 'invite' || type === 'magiclink') {
        // Establish the session from the link tokens
        const { error } = await supabase.auth.setSession({ access_token, refresh_token })
        if (!error) router.replace('/(auth)/set-password')
      }
    }

    // Handle link that opened the app (cold start)
    Linking.getInitialURL().then(url => { if (url) handleDeepLink(url) })
    // Handle link while app is already open (warm start)
    const linkSub = Linking.addEventListener('url', ({ url }) => handleDeepLink(url))

    // Notification received while app is open — can be used to show in-app banner
    notifListener.current = Notifications.addNotificationReceivedListener(() => {})

    // User taps on a notification — navigate to the relevant screen
    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      const screen = response.notification.request.content.data?.screen as string | undefined
      if (screen === 'chat') router.push('/(tabs)/4-chat')
      else if (screen === 'checkin') router.push('/(tabs)/5-checkin')
      else if (screen === 'package') router.push('/package')
    })

    return () => {
      mounted = false
      clearTimeout(startupTimeout)
      subscription.unsubscribe()
      linkSub.remove()
      notifListener.current?.remove()
      responseListener.current?.remove()
    }
  }, [])

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f9fafb' }}>
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text style={{ marginTop: 12, fontSize: 11, color: '#9ca3af' }}>Step 1/3 — validating session</Text>
      </View>
    )
  }

  return (
    <ClientProvider>
    <LanguageProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
        <Stack.Screen name="(auth)/login" />
        <Stack.Screen name="(auth)/forgot-password" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="(auth)/set-password" options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
        <Stack.Screen name="checkin-history" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="compare-photos" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="workout-history" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="metrics" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="nutrition-history" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="package" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="timeline" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="settings" options={{ animation: 'slide_from_right' }} />
      </Stack>
    </LanguageProvider>
    </ClientProvider>
  )
}
