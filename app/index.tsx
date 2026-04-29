import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '@/lib/supabase'
import { Redirect, type Href } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'

const HAS_SEEN_ONBOARDING = 'hasSeenOnboarding'

export default function Index() {
  const [ready, setReady] = useState(false)
  const [hasSession, setHasSession] = useState(false)
  const [seenOnboarding, setSeenOnboarding] = useState(true)

  useEffect(() => {
    let cancelled = false

    // No timeout here — root layout (_layout.tsx) is the single gatekeeper:
    // it runs getSession + getUser with its own 10s timeout and only unmounts
    // the loading screen once auth state is settled. By the time index.tsx
    // mounts, supabase-js auth is done and getSession() returns quickly.
    // Adding a redundant timeout here caused false "no session" routes to login
    // because supabase-js was still finishing a background token-storage write.
    Promise.all([
      supabase.auth.getSession(),
      AsyncStorage.getItem(HAS_SEEN_ONBOARDING),
    ])
      .then(([{ data: { session } }, seen]) => {
        if (cancelled) return
        setHasSession(!!session)
        setSeenOnboarding(seen === 'true')
        setReady(true)
      })
      .catch(() => {
        if (cancelled) return
        setHasSession(false)
        setSeenOnboarding(false)
        setReady(true)
      })

    return () => { cancelled = true }
  }, [])

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f9fafb' }}>
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text style={{ marginTop: 12, fontSize: 11, color: '#9ca3af' }}>Step 2/3 — checking session</Text>
      </View>
    )
  }

  if (!seenOnboarding) return <Redirect href={'/onboarding' as Href} />

  return hasSession ? <Redirect href="/(tabs)" /> : <Redirect href="/(auth)/login" />
}
