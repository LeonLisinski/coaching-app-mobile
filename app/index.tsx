import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '@/lib/supabase'
import { Redirect, type Href } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'

const HAS_SEEN_ONBOARDING = 'hasSeenOnboarding'

export default function Index() {
  const [ready, setReady] = useState(false)
  const [hasSession, setHasSession] = useState(false)
  const [seenOnboarding, setSeenOnboarding] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.auth.getSession(),
      AsyncStorage.getItem(HAS_SEEN_ONBOARDING),
    ])
      .then(([{ data: { session } }, seen]) => {
        setHasSession(!!session)
        setSeenOnboarding(seen === 'true')
      })
      .catch(() => {
        setHasSession(false)
        setSeenOnboarding(false)
      })
      .finally(() => setReady(true))
  }, [])

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f9fafb' }}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    )
  }

  if (!seenOnboarding) return <Redirect href={'/onboarding' as Href} />

  return hasSession ? <Redirect href="/(tabs)" /> : <Redirect href="/(auth)/login" />
}
