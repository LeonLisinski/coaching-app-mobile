import AsyncStorage from '@react-native-async-storage/async-storage'
import { Redirect, type Href } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { getStartupSession } from '@/lib/startupAuth'

const HAS_SEEN_ONBOARDING = 'hasSeenOnboarding'

export default function Index() {
  const [ready, setReady] = useState(false)
  const [hasSession, setHasSession] = useState(false)
  const [seenOnboarding, setSeenOnboarding] = useState(true)

  useEffect(() => {
    let cancelled = false

    // _layout.tsx (root layout, always mounts first) already read the stored
    // session from SecureStore and wrote the result to startupAuth.ts before
    // calling setLoading(false) — which is what triggers this component to
    // mount. Reading that cached boolean here is zero-I/O and cannot hang.
    //
    // We do NOT call SecureStore.getItemAsync again: on Android a second
    // getItemAsync on the same key while supabase-js is concurrently writing
    // (after a background token refresh) can block indefinitely with no
    // timeout or rejection, causing Step 2 to spin forever.
    const hasSession = getStartupSession()
    const timeout = setTimeout(() => {
      if (cancelled) return
      console.warn('[index] timeout fallback')
      setSeenOnboarding(true)
      setHasSession(hasSession)
      setReady(true)
    }, 3000)

    AsyncStorage.getItem(HAS_SEEN_ONBOARDING)
      .then(seen => {
        if (cancelled) return
        clearTimeout(timeout)
        setHasSession(hasSession)
        setSeenOnboarding(seen === 'true')
        setReady(true)
      })
      .catch(() => {
        if (cancelled) return
        clearTimeout(timeout)
        setHasSession(hasSession)
        setSeenOnboarding(false)
        setReady(true)
      })

    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
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
