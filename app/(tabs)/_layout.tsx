import { supabase } from '@/lib/supabase'
import { useClient } from '@/lib/ClientContext'
import { Tabs, useRouter } from 'expo-router'
import { ClipboardCheck, Dumbbell, Home, MessageCircle, Salad } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Platform, Text, TouchableOpacity, View } from 'react-native'

type AccessStatus = 'loading' | 'ok' | 'inactive_client' | 'inactive_trainer'

export default function TabsLayout() {
  const router = useRouter()
  const { setClientData, setProfile, setCheckinConfig, setCheckinParams, setClientCreatedAt } = useClient()
  const [unreadCount, setUnreadCount] = useState(0)
  const [clientId, setClientId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [accessStatus, setAccessStatus] = useState<AccessStatus>('loading')

  useEffect(() => {
    // On timeout redirect to login instead of showing a misleading "account deactivated" screen
    const timeout = setTimeout(() => router.replace('/(auth)/login'), 15000)

    const init = async () => {
      try {
        // getSession() reads from device storage — no network latency on startup
        const { data: { session } } = await supabase.auth.getSession()
        const user = session?.user
        if (!user) { router.replace('/(auth)/login'); return }
        setUserId(user.id)

        // Fetch the active trainer-client relationship for this user.
        // A user may have multiple historical rows in `clients` (e.g. switched
        // trainers over time) but at most ONE active row at any time, enforced
        // by the partial unique index `clients_one_active_per_user`.
        // Use limit(1) + maybeSingle to be defensive even if the invariant
        // is ever violated.
        const { data: client } = await supabase
          .from('clients')
          .select('id, active, trainer_id, created_at')
          .eq('user_id', user.id)
          .eq('active', true)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (!client) {
          setAccessStatus('inactive_client')
          return
        }

        // All independent queries run in parallel — shared cache data piggybacked at no extra cost
        const [
          { data: trainerActive },
          { count },
          { data: profileData },
          { data: configData },
          { data: paramsData },
        ] = await Promise.all([
          supabase.rpc('get_trainer_subscription_active', { p_trainer_id: client.trainer_id }),
          supabase
            .from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('client_id', client.id)
            .eq('read', false)
            .neq('sender_id', user.id),
          supabase
            .from('profiles')
            .select('full_name, email')
            .eq('id', user.id)
            .single(),
          supabase
            .from('checkin_config')
            .select('checkin_day, photo_frequency, photo_positions')
            .eq('client_id', client.id)
            .maybeSingle(),
          supabase
            .from('checkin_parameters')
            .select('id, name, type, unit, options, required, order_index, frequency')
            .eq('trainer_id', client.trainer_id)
            .order('order_index'),
        ])

        if (trainerActive !== true) {
          setAccessStatus('inactive_trainer')
          return
        }

        setClientId(client.id)
        setAccessStatus('ok')
        setUnreadCount(count ?? 0)
        // Populate shared context so all screens can skip their own fetches
        setClientData({ clientId: client.id, trainerId: client.trainer_id, userId: user.id })
        if (profileData) setProfile(profileData)
        if (configData) setCheckinConfig(configData)
        if (paramsData) setCheckinParams(paramsData)
        if ((client as any).created_at) setClientCreatedAt((client as any).created_at.split('T')[0])
      } catch {
        // Network error on startup — redirect to login so the user isn't stuck
        router.replace('/(auth)/login')
      } finally {
        clearTimeout(timeout)
      }
    }
    init()
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
