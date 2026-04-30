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