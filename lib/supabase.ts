import * as SecureStore from 'expo-secure-store'
import { createClient } from '@supabase/supabase-js'
import { AppState, Platform } from 'react-native'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

const ExpoSecureStoreAdapter = {
  getItem: async (key: string) => {
    try { return await SecureStore.getItemAsync(key) } catch { return null }
  },
  setItem: async (key: string, value: string) => {
    try { await SecureStore.setItemAsync(key, value) } catch { }
  },
  removeItem: async (key: string) => {
    try { await SecureStore.deleteItemAsync(key) } catch { }
  },
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // On React Native there is only one JS context (no browser tabs), so the
    // multi-tab web mutex is unnecessary. supabase-js v2 holds this lock during
    // every auth operation — including the background _recoverAndRefresh() that
    // runs on startup — which forces all subsequent getSession() calls to queue
    // and wait, causing Step 1/2/3 hangs on Android cold-start when the network
    // is slow. Passing a no-op lock eliminates all queuing while remaining safe
    // because there is only ever one concurrent writer on mobile.
    ...(Platform.OS !== 'web' && {
      lock: (_name: string, _acquireTimeout: number, fn: () => Promise<unknown>) => fn(),
    }),
  },
})

// Pause token refresh when app is in background, resume when active
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh()
  } else {
    supabase.auth.stopAutoRefresh()
  }
})