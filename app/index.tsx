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

    // Hard 4s timeout: if either getSession or AsyncStorage hangs (Android
    // lock contention with background auto-refresh), default to no-session
    // and let downstream layers handle it. Without this, the app could be
    // stuck on this loading screen forever.
    const timeout = setTimeout(() => {
      if (cancelled) return
      console.warn('[index] auth check timed out → routing to login')
      setHasSession(false)
      setSeenOnboarding(true)
      setReady(true)
    }, 4000)

    Promise.all([
      supabase.auth.getSession(),
      AsyncStorage.getItem(HAS_SEEN_ONBOARDING),
    ])
      .then(([{ data: { session } }, seen]) => {
        if (cancelled) return
        clearTimeout(timeout)
        setHasSession(!!session)
        setSeenOnboarding(seen === 'true')
        setReady(true)
      })
      .catch(() => {
        if (cancelled) return
        clearTimeout(timeout)
        setHasSession(false)
        setSeenOnboarding(false)
        setReady(true)
      })

    return () => { cancelled = true; clearTimeout(timeout) }
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
