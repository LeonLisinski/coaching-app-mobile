import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'
import { Platform } from 'react-native'

const supabaseUrl = 'https://nvlrlubvxelrwdzggmno.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im52bHJsdWJ2eGVscndkemdnbW5vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMDAwNTYsImV4cCI6MjA4Nzc3NjA1Nn0.Bk9DVYXbxWeqcXzZz8Ue23mdfLuVzENxbO8kBgB2-sI'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})