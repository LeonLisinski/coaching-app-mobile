import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { supabase } from '@/lib/supabase'
import { Redirect, type Href } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Platform, Text, View } from 'react-native'
// dist/main = CommonJS build, safe for Metro/React Native bundler
import { STORAGE_KEY as SUPABASE_STORAGE_KEY } from '@supabase/auth-js/dist/main/lib/constants'

const HAS_SEEN_ONBOARDING = 'hasSeenOnboarding'

export default function Index() {
  const [ready, setReady] = useState(false)
  const [hasSession, setHasSession] = useState(false)
  const [seenOnboarding, setSeenOnboarding] = useState(true)

  useEffect(() => {
    let cancelled = false

    // Same reasoning as _layout.tsx: read SecureStore directly instead of
    // supabase.auth.getSession() to avoid blocking on initializePromise while
    // supabase-js does a background token refresh on Android cold-start.
    const readSession =
      Platform.OS !== 'web'
        ? SecureStore.getItemAsync(SUPABASE_STORAGE_KEY).then(raw => {
            if (!raw) return false
            try {
              const parsed = JSON.parse(raw)
              return !!(parsed?.access_token && parsed?.user)
            } catch { return false }
          }).catch(() => false)
        : supabase.auth.getSession().then(({ data: { session } }) => !!session)

    Promise.all([readSession, AsyncStorage.getItem(HAS_SEEN_ONBOARDING)])
      .then(([hasSession, seen]) => {
        if (cancelled) return
        setHasSession(hasSession)
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
