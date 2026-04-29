import * as Linking from 'expo-linking'
import * as Notifications from 'expo-notifications'
import { Stack, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { registerForPushNotificationsAsync } from '@/lib/notifications'
import { supabase } from '@/lib/supabase'
import { LanguageProvider } from '@/lib/LanguageContext'
import { ClientProvider } from '@/lib/ClientContext'
import { Session } from '@supabase/supabase-js'

export default function RootLayout() {
  const router = useRouter()
  const [, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const notifListener = useRef<Notifications.EventSubscription | null>(null)
  const responseListener = useRef<Notifications.EventSubscription | null>(null)

  useEffect(() => {
    // Safety timeout — if getSession() never resolves (e.g. cold-start network error),
    // force loading=false after 6s so the user isn't stuck on a spinner forever
    const timeout = setTimeout(() => setLoading(false), 6000)

    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setSession(session)
        // Register push token in background — must not block the loading gate.
        // Use the active row; .maybeSingle keeps us defensive against 0/N rows.
        if (session) {
          supabase
            .from('clients')
            .select('id')
            .eq('user_id', session.user.id)
            .eq('active', true)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
            .then(({ data: client }) => {
              if (client) registerForPushNotificationsAsync(client.id)
            })
        }
      })
      .catch(() => {
        // session stays null — user will be redirected to login
      })
      .finally(() => {
        clearTimeout(timeout)
        setLoading(false)
      })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      setSession(session)

      // Redirect to login when session is invalidated (expired token, remote sign-out, etc.)
      if (event === 'SIGNED_OUT' || (!session && event === 'TOKEN_REFRESHED')) {
        router.replace('/(auth)/login')
        return
      }

      // Re-register on every login (token may have rotated)
      if (session) {
        const { data: client } = await supabase
          .from('clients')
          .select('id')
          .eq('user_id', session.user.id)
          .eq('active', true)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (client) registerForPushNotificationsAsync(client.id)
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
