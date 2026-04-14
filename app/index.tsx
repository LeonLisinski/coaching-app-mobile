import { supabase } from '@/lib/supabase'
import { Redirect } from 'expo-router'
import { useEffect, useState } from 'react'

export default function Index() {
  const [hasSession, setHasSession] = useState<boolean | null>(null)

  useEffect(() => {
    // _layout.tsx already resolved getSession() before rendering this component,
    // so this call returns from Supabase's in-memory cache — essentially instant.
    supabase.auth.getSession()
      .then(({ data: { session } }) => setHasSession(!!session))
      .catch(() => setHasSession(false))
  }, [])

  // null = still resolving (cache hit, so this is one frame at most)
  if (hasSession === null) return null

  return hasSession ? <Redirect href="/(tabs)" /> : <Redirect href="/(auth)/login" />
}
