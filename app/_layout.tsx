import * as Notifications from 'expo-notifications'
import { Stack, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { registerForPushNotificationsAsync } from '@/lib/notifications'
import { supabase } from '@/lib/supabase'
import { LanguageProvider } from '@/lib/LanguageContext'
import { Session } from '@supabase/supabase-js'

export default function RootLayout() {
  const router = useRouter()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const notifListener = useRef<Notifications.EventSubscription | null>(null)
  const responseListener = useRef<Notifications.EventSubscription | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session)
      if (session) {
        const { data: client } = await supabase
          .from('clients')
          .select('id')
          .eq('user_id', session.user.id)
          .single()
        if (client) registerForPushNotificationsAsync(client.id)
      }
    })

    // Notification received while app is open — can be used to show in-app banner
    notifListener.current = Notifications.addNotificationReceivedListener(() => {})

    // User taps on a notification — navigate to the relevant screen
    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      const screen = response.notification.request.content.data?.screen as string | undefined
      if (screen === 'chat') router.push('/(tabs)/4-chat')
      else if (screen === 'checkin') router.push('/(tabs)/5-checkin')
    })

    return () => {
      subscription.unsubscribe()
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
    <LanguageProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)/login" />
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
  )
}
