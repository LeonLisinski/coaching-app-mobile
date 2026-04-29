import { supabase } from '@/lib/supabase'
import { useClient } from '@/lib/ClientContext'
import { Tabs, useRouter } from 'expo-router'
import { ClipboardCheck, Dumbbell, Home, MessageCircle, Salad } from 'lucide-react-native'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Platform, Text, TouchableOpacity, View } from 'react-native'

type AccessStatus = 'loading' | 'ok' | 'inactive_client' | 'inactive_trainer' | 'error'

// Wraps a Supabase builder (a thenable, NOT a real Promise — it lacks .catch)
// in a real Promise that always resolves with either the result or `fallback`.
// Races against a timeout so a hung query never blocks the UI.
function withFallback<T>(
  builder: PromiseLike<{ data: T | null }>,
  fallback: T | null,
  ms: number,
): Promise<{ data: T | null }> {
  const safe = (async () => {
    try { return await builder } catch { return { data: fallback } }
  })()
  return Promise.race([
    safe,
    new Promise<{ data: T | null }>(resolve =>
      setTimeout(() => resolve({ data: fallback }), ms),
    ),
  ])
}

export default function TabsLayout() {
  const router = useRouter()
  const { setClientData, setProfile, setCheckinConfig, setCheckinParams, setClientCreatedAt } = useClient()
  const [unreadCount, setUnreadCount] = useState(0)
  const [clientId, setClientId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [accessStatus, setAccessStatus] = useState<AccessStatus>('loading')
  const retryRef = useRef(0)

  const runInit = async () => {
    setAccessStatus('loading')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) { router.replace('/(auth)/login'); return }
      setUserId(user.id)

      type ClientRow = { id: string; active: boolean; trainer_id: string; created_at: string }
      type QResult = { data: ClientRow | null; error: { message: string } | null }
      const { data: client, error: clientErr } = await Promise.race<QResult>([
        supabase
          .from('clients')
          .select('id, active, trainer_id, created_at')
          .eq('user_id', user.id)
          .eq('active', true)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle() as unknown as Promise<QResult>,
        new Promise<QResult>(resolve =>
          setTimeout(() => resolve({ data: null, error: { message: 'clients query timed out' } }), 9000)
        ),
      ])

      if (clientErr) {
        const em = (clientErr.message ?? '').toLowerCase()
        const isAuthError =
          em.includes('token') || em.includes('refresh') || em.includes('session') ||
          em.includes('jwt') || em.includes('auth') || em.includes('timed out')
        if (isAuthError) {
          supabase.auth.signOut({ scope: 'local' }).catch(() => {})
          router.replace('/(auth)/login')
          return
        }
        setAccessStatus('error')
        return
      }

      if (!client) {
        setAccessStatus('inactive_client')
        return
      }

      // Run all 5 secondary queries in parallel with per-query 7s fallbacks.
      // The RPC is the most likely to be slow — it falls back to null, which
      // triggers the "inactive_trainer" screen. Data queries fall back to
      // empty/null (non-blocking: the individual screens re-fetch on mount).
      const [
        rpcResult,
        { count },
        { data: profileData },
        { data: configData },
        { data: paramsData },
      ] = await Promise.all([
        withFallback(
          supabase.rpc('get_trainer_subscription_active', { p_trainer_id: client.trainer_id }) as unknown as PromiseLike<{ data: boolean | null }>,
          null, 7000
        ),
        withFallback(
          supabase.from('messages').select('*', { count: 'exact', head: true })
            .eq('client_id', client.id).eq('read', false).neq('sender_id', user.id),
          null, 6000
        ),
        withFallback(
          supabase.from('profiles').select('full_name, email').eq('id', user.id).maybeSingle() as any,
          null, 6000
        ),
        withFallback(
          supabase.from('checkin_config').select('checkin_day, photo_frequency, photo_positions')
            .eq('client_id', client.id).maybeSingle() as any,
          null, 6000
        ),
        withFallback(
          supabase.from('checkin_parameters')
            .select('id, name, type, unit, options, required, order_index, frequency')
            .eq('trainer_id', client.trainer_id).order('order_index') as any,
          [], 6000
        ),
      ])

      const trainerActive = (rpcResult as any)?.data

      if (trainerActive !== true) {
        setAccessStatus('inactive_trainer')
        return
      }

      setClientId(client.id)
      setAccessStatus('ok')
      setUnreadCount((count as any) ?? 0)
      setClientData({ clientId: client.id, trainerId: client.trainer_id, userId: user.id })
      if (profileData) setProfile(profileData as any)
      if (configData) setCheckinConfig(configData as any)
      if (paramsData) setCheckinParams(paramsData as any)
      if ((client as any).created_at) setClientCreatedAt((client as any).created_at.split('T')[0])
    } catch (e) {
      const rawMsg = (e as Error)?.message ?? ''
      const msg = String(rawMsg).toLowerCase()
      console.error('[runInit CATCH]', { rawMsg, error: e })
      if (msg.includes('token') || msg.includes('refresh') || msg.includes('session') || msg.includes('jwt') || msg.includes('auth')) {
        supabase.auth.signOut({ scope: 'local' }).catch(() => {})
        router.replace('/(auth)/login')
      } else {
        setAccessStatus('error')
      }
    }
  }

  useEffect(() => {
    runInit()
  }, [])

  // Subscribe to message changes for live badge updates
  useEffect(() => {
    if (!clientId || !userId) return
    const channel = supabase
      .channel(`tab-badge-${clientId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `client_id=eq.${clientId}` },
        async () => {
          const { count } = await supabase
            .from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('client_id', clientId)
            .eq('read', false)
            .neq('sender_id', userId)
          setUnreadCount(count ?? 0)
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [clientId, userId])

  if (accessStatus === 'loading') {
    return (
      <View style={bs.center}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    )
  }

  if (accessStatus === 'error') {
    return (
      <View style={bs.center}>
        <View style={bs.card}>
          <Text style={bs.icon}>📡</Text>
          <Text style={bs.title}>Nema veze</Text>
          <Text style={bs.sub}>Provjeri internetsku vezu i pokušaj ponovo.</Text>
          <TouchableOpacity style={bs.btn} onPress={() => { retryRef.current += 1; runInit() }}>
            <Text style={bs.btnText}>Pokušaj ponovo</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  if (accessStatus === 'inactive_client') {
    return (
      <View style={bs.center}>
        <View style={bs.card}>
          <Text style={bs.icon}>🔒</Text>
          <Text style={bs.title}>Račun je deaktiviran</Text>
          <Text style={bs.sub}>Vaš trener je deaktivirao vaš račun. Kontaktirajte trenera za više informacija.</Text>
          <TouchableOpacity style={bs.btn} onPress={async () => { await supabase.auth.signOut(); router.replace('/(auth)/login') }}>
            <Text style={bs.btnText}>Odjava</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  if (accessStatus === 'inactive_trainer') {
    return (
      <View style={bs.center}>
        <View style={bs.card}>
          <Text style={bs.icon}>⚠️</Text>
          <Text style={bs.title}>Usluga privremeno nedostupna</Text>
          <Text style={bs.sub}>Vaš trener trenutno nema aktivnu pretplatu. Kontaktirajte ga kako bi obnovio pristup.</Text>
          <TouchableOpacity style={bs.btn} onPress={async () => { await supabase.auth.signOut(); router.replace('/(auth)/login') }}>
            <Text style={bs.btnText}>Odjava</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#3b82f6',
        tabBarInactiveTintColor: '#9ca3af',
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: 'white',
          borderTopColor: '#f3f4f6',
          borderTopWidth: 1,
          height: Platform.OS === 'ios' ? 88 : 64,
          paddingBottom: Platform.OS === 'ios' ? 28 : 10,
          paddingTop: 10,
        },
      }}
    >
      <Tabs.Screen
        name="1-training"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <View style={{ alignItems: 'center', gap: 3 }}>
              <Dumbbell size={22} color={color} strokeWidth={focused ? 2.5 : 1.8} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="2-nutrition"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <View style={{ alignItems: 'center', gap: 3 }}>
              <Salad size={22} color={color} strokeWidth={focused ? 2.5 : 1.8} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <View style={{
              backgroundColor: focused ? '#3b82f6' : '#f3f4f6',
              borderRadius: 16,
              padding: 10,
            }}>
              <Home size={22} color={focused ? 'white' : '#9ca3af'} strokeWidth={focused ? 2.5 : 1.8} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="4-chat"
        listeners={{ tabPress: () => setUnreadCount(0) }}
        options={{
          tabBarIcon: ({ color, focused }) => (
            <View style={{ alignItems: 'center' }}>
              <MessageCircle size={22} color={color} strokeWidth={focused ? 2.5 : 1.8} />
              {unreadCount > 0 && (
                <View style={{
                  position: 'absolute',
                  top: -4, right: -8,
                  backgroundColor: '#ef4444',
                  borderRadius: 99,
                  minWidth: 16, height: 16,
                  alignItems: 'center', justifyContent: 'center',
                  paddingHorizontal: 3,
                  borderWidth: 1.5, borderColor: 'white',
                }}>
                  <Text style={{
                    color: 'white', fontSize: 9,
                    fontWeight: '800', lineHeight: 12,
                  }}>
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </Text>
                </View>
              )}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="5-checkin"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <View style={{ alignItems: 'center' }}>
              <ClipboardCheck size={22} color={color} strokeWidth={focused ? 2.5 : 1.8} />
            </View>
          ),
        }}
      />
    </Tabs>
  )
}

import { StyleSheet } from 'react-native'
const bs = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: 'white', borderRadius: 24, padding: 28, alignItems: 'center', width: '100%', maxWidth: 360, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 4 },
  icon: { fontSize: 48, marginBottom: 16 },
  title: { fontSize: 18, fontWeight: '800', color: '#111827', textAlign: 'center', marginBottom: 10 },
  sub: { fontSize: 14, color: '#6b7280', textAlign: 'center', lineHeight: 21, marginBottom: 24 },
  btn: { backgroundColor: '#3b82f6', borderRadius: 14, paddingVertical: 13, paddingHorizontal: 32 },
  btnText: { color: 'white', fontWeight: '700', fontSize: 15 },
})
