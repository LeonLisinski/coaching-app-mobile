import { supabase } from '@/lib/supabase'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

type Profile = { full_name: string; email: string }
type CheckinConfig = { checkin_day: number | null }
type TodayCheckin = { id: string } | null

const DAYS = ['Nedjelja', 'Ponedjeljak', 'Utorak', 'Srijeda', 'Četvrtak', 'Petak', 'Subota']

export default function HomeScreen() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [checkinConfig, setCheckinConfig] = useState<CheckinConfig | null>(null)
  const [todayCheckin, setTodayCheckin] = useState<TodayCheckin>(null)
  const [hasTraining, setHasTraining] = useState(false)
  const [hasNutrition, setHasNutrition] = useState(false)
  const [unreadMessages, setUnreadMessages] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const today = new Date().toISOString().split('T')[0]

    const [{ data: profileData }, { data: clientData }] = await Promise.all([
      supabase.from('profiles').select('full_name, email').eq('id', user.id).single(),
      supabase.from('clients').select('id').eq('user_id', user.id).single(),
    ])

    if (profileData) setProfile(profileData)

    if (clientData) {
      const clientId = clientData.id
      const [
        { data: configData }, { data: checkinData },
        { data: trainingData }, { data: nutritionData }, { data: messagesData },
      ] = await Promise.all([
        supabase.from('checkin_config').select('checkin_day').eq('client_id', clientId).single(),
        supabase.from('checkins').select('id').eq('client_id', clientId).eq('date', today).single(),
        supabase.from('client_workout_plans').select('id').eq('client_id', clientId).limit(1),
        supabase.from('client_meal_plans').select('id').eq('client_id', clientId).limit(1),
        supabase.from('messages').select('id').eq('client_id', clientId).eq('read', false).neq('sender_id', user.id),
      ])
      if (configData) setCheckinConfig(configData)
      setTodayCheckin(checkinData)
      setHasTraining((trainingData?.length ?? 0) > 0)
      setHasNutrition((nutritionData?.length ?? 0) > 0)
      setUnreadMessages(messagesData?.length ?? 0)
    }
    setLoading(false)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.replace('/(auth)/login')
  }

  const getGreeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Dobro jutro'
    if (h < 18) return 'Dobar dan'
    return 'Dobra večer'
  }

  const firstName = profile?.full_name?.split(' ')[0] || ''
  const todayDay = new Date().getDay()
  const isCheckinDay = checkinConfig?.checkin_day === todayDay

  if (loading) return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color="#6366f1" />
    </View>
  )

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

      {/* Header s gradientom efektom */}
      <View style={styles.headerBg}>
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>{getGreeting()}</Text>
            <Text style={styles.name}>{firstName} 👋</Text>
          </View>
          <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
            <Text style={styles.logoutText}>Odjava</Text>
          </TouchableOpacity>
        </View>

        {/* Check-in card unutar headera */}
        {isCheckinDay && !todayCheckin ? (
          <TouchableOpacity
            style={styles.checkinAlert}
            onPress={() => router.push('/(tabs)/5-checkin')}
          >
            <View style={styles.checkinAlertLeft}>
              <Text style={styles.checkinAlertEmoji}>📋</Text>
              <View>
                <Text style={styles.checkinAlertTitle}>Check-in te čeka!</Text>
                <Text style={styles.checkinAlertSub}>Danas je tvoj dan — pošalji sada</Text>
              </View>
            </View>
            <Text style={styles.checkinAlertArrow}>→</Text>
          </TouchableOpacity>
        ) : todayCheckin ? (
          <View style={styles.checkinDone}>
            <Text style={styles.checkinDoneText}>✓ Današnji check-in poslan</Text>
          </View>
        ) : null}
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statEmoji}>🏋️</Text>
          <Text style={styles.statLabel}>Trening</Text>
          <Text style={[styles.statValue, !hasTraining && styles.statValueOff]}>
            {hasTraining ? 'Aktivan' : 'Nema'}
          </Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statCard}>
          <Text style={styles.statEmoji}>🥗</Text>
          <Text style={styles.statLabel}>Prehrana</Text>
          <Text style={[styles.statValue, !hasNutrition && styles.statValueOff]}>
            {hasNutrition ? 'Aktivan' : 'Nema'}
          </Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statCard}>
          <Text style={styles.statEmoji}>📊</Text>
          <Text style={styles.statLabel}>Check-in</Text>
          <Text style={styles.statValue}>
            {checkinConfig?.checkin_day != null ? DAYS[checkinConfig.checkin_day].slice(0, 3) : 'N/A'}
          </Text>
        </View>
      </View>

      {/* Quick actions */}
      <Text style={styles.sectionTitle}>Brzi pristup</Text>
      <View style={styles.grid}>

        <TouchableOpacity
          style={[styles.quickCard, styles.quickCardBlue]}
          onPress={() => router.push('/(tabs)/1-training')}
          activeOpacity={0.85}
        >
          <Text style={styles.quickCardEmoji}>🏋️</Text>
          <Text style={styles.quickCardTitleLight}>Trening</Text>
          <Text style={styles.quickCardSubLight}>{hasTraining ? 'Pregled plana →' : 'Nema plana'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.quickCard, styles.quickCardGreen]}
          onPress={() => router.push('/(tabs)/2-nutrition')}
          activeOpacity={0.85}
        >
          <Text style={styles.quickCardEmoji}>🥗</Text>
          <Text style={styles.quickCardTitleLight}>Prehrana</Text>
          <Text style={styles.quickCardSubLight}>{hasNutrition ? 'Pregled plana →' : 'Nema plana'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.quickCard, styles.quickCardPurple]}
          onPress={() => router.push('/(tabs)/4-chat')}
          activeOpacity={0.85}
        >
          <Text style={styles.quickCardEmoji}>💬</Text>
          <Text style={styles.quickCardTitleLight}>Chat</Text>
          <Text style={styles.quickCardSubLight}>
            {unreadMessages > 0 ? `${unreadMessages} nova →` : 'Poruke →'}
          </Text>
          {unreadMessages > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>{unreadMessages}</Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.quickCard, styles.quickCardOrange]}
          onPress={() => router.push('/(tabs)/5-checkin')}
          activeOpacity={0.85}
        >
          <Text style={styles.quickCardEmoji}>📊</Text>
          <Text style={styles.quickCardTitleLight}>Check-in</Text>
          <Text style={styles.quickCardSubLight}>Unesi podatke →</Text>
        </TouchableOpacity>

      </View>

    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { paddingBottom: 32 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f3f4f6' },

  // Header
  headerBg: {
    backgroundColor: '#1e1b4b',
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 24,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    marginBottom: 16,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  greeting: { fontSize: 14, color: '#a5b4fc', fontWeight: '500' },
  name: { fontSize: 28, fontWeight: '800', color: 'white', marginTop: 2 },
  logoutBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 8 },
  logoutText: { fontSize: 13, color: '#a5b4fc' },

  // Check-in alert
  checkinAlert: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  checkinAlertLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkinAlertEmoji: { fontSize: 28 },
  checkinAlertTitle: { fontSize: 15, fontWeight: '700', color: 'white' },
  checkinAlertSub: { fontSize: 12, color: '#a5b4fc', marginTop: 2 },
  checkinAlertArrow: { fontSize: 20, color: 'white' },
  checkinDone: {
    backgroundColor: 'rgba(34,197,94,0.2)',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.3)',
  },
  checkinDoneText: { color: '#86efac', fontWeight: '600', fontSize: 14 },

  // Stats
  statsRow: {
    flexDirection: 'row',
    backgroundColor: 'white',
    borderRadius: 16,
    marginHorizontal: 20,
    marginBottom: 24,
    paddingVertical: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  statCard: { flex: 1, alignItems: 'center', gap: 4 },
  statDivider: { width: 1, backgroundColor: '#f3f4f6', marginVertical: 4 },
  statEmoji: { fontSize: 22 },
  statLabel: { fontSize: 11, color: '#9ca3af', fontWeight: '500' },
  statValue: { fontSize: 13, fontWeight: '700', color: '#111827' },
  statValueOff: { color: '#d1d5db' },

  // Section
  sectionTitle: {
    fontSize: 13, fontWeight: '700', color: '#6b7280',
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginBottom: 12, marginHorizontal: 20,
  },

  // Grid
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 20 },
  quickCard: {
    width: '47%', borderRadius: 20, padding: 18, position: 'relative',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1, shadowRadius: 8, elevation: 3,
  },
  quickCardBlue: { backgroundColor: '#3b82f6' },
  quickCardGreen: { backgroundColor: '#10b981' },
  quickCardPurple: { backgroundColor: '#8b5cf6' },
  quickCardOrange: { backgroundColor: '#f59e0b' },
  quickCardEmoji: { fontSize: 32, marginBottom: 12 },
  quickCardTitleLight: { fontSize: 15, fontWeight: '700', color: 'white', marginBottom: 4 },
  quickCardSubLight: { fontSize: 12, color: 'rgba(255,255,255,0.75)' },
  unreadBadge: {
    position: 'absolute', top: 12, right: 12,
    backgroundColor: '#ef4444', borderRadius: 99,
    minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5,
  },
  unreadBadgeText: { color: 'white', fontSize: 11, fontWeight: '700' },
})