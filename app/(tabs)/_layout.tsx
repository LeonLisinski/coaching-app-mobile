import { supabase } from '@/lib/supabase'
import { Tabs } from 'expo-router'
import { ClipboardCheck, Dumbbell, Home, MessageCircle, Salad } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { Platform, Text, View } from 'react-native'

export default function TabsLayout() {
  const [unreadCount, setUnreadCount] = useState(0)
  const [clientId, setClientId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)

      const { data: client } = await supabase
        .from('clients').select('id')
        .eq('user_id', user.id).single()
      if (!client) return
      setClientId(client.id)

      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .eq('read', false)
        .neq('sender_id', user.id)
      setUnreadCount(count ?? 0)
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
