import { supabase } from '@/lib/supabase'
import { useLanguage } from '@/lib/LanguageContext'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator, Platform, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native'

type EventType = 'checkin' | 'package' | 'payment' | 'workout_plan' | 'meal_plan'

type TimelineEvent = {
  id: string
  date: string
  type: EventType
  title: string
  subtitle?: string
  meta?: string
  metaPositive?: boolean
  color: string
  emoji: string
}

const TYPE_CONFIG: Record<EventType, { emoji: string; color: string }> = {
  checkin:      { emoji: 'C', color: '#7c3aed' },
  package:      { emoji: 'P', color: '#0891b2' },
  payment:      { emoji: '✓', color: '#059669' },
  workout_plan: { emoji: 'T', color: '#4f46e5' },
  meal_plan:    { emoji: 'M', color: '#ea580c' },
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('hr-HR', { day: 'numeric', month: 'long', year: 'numeric' })
}

function getMonthKey(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

type GroupedEvents = { monthKey: string; events: TimelineEvent[] }[]

export default function TimelineScreen() {
  const { t } = useLanguage()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [groups, setGroups] = useState<GroupedEvents>([])
  const [totalEvents, setTotalEvents] = useState(0)
  const [activeFilter, setActiveFilter] = useState<EventType | 'all'>('all')

  const MONTH_NAMES = t('months').split(',')
  const monthLabel = (key: string) => {
    const [year, month] = key.split('-')
    return `${MONTH_NAMES[parseInt(month) - 1]} ${year}`
  }

  useEffect(() => { fetchTimeline() }, [])

  const fetchTimeline = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: client } = await supabase
      .from('clients').select('id, trainer_id')
      .eq('user_id', user.id).single()
    if (!client) { setLoading(false); return }

    const [
      { data: checkins },
      { data: packages },
      { data: workoutPlans },
      { data: mealPlans },
    ] = await Promise.all([
      supabase.from('checkins')
        .select('id, date, values, trainer_comment')
        .eq('client_id', client.id)
        .order('date', { ascending: false })
        .limit(200),
      supabase.from('client_packages')
        .select('id, start_date, price, status, packages(name, color), payments(paid_at, amount, status)')
        .eq('client_id', client.id)
        .order('start_date', { ascending: false }),
      supabase.from('client_workout_plans')
        .select('id, assigned_at, workout_plan:workout_plans(name)')
        .eq('client_id', client.id)
        .order('assigned_at', { ascending: false })
        .limit(30),
      supabase.from('client_meal_plans')
        .select('id, assigned_at, meal_plan:meal_plans(name)')
        .eq('client_id', client.id)
        .order('assigned_at', { ascending: false })
        .limit(30),
    ])

    const all: TimelineEvent[] = []

    // Check-ins — compute weight diff
    let prevWeight: number | null = null
    const sortedCheckins = [...(checkins ?? [])].sort((a, b) => a.date.localeCompare(b.date))
    sortedCheckins.forEach((c: any) => {
      const weight = c.values?.weight ?? c.values?.tezina ?? null
      const weightNum = weight !== null ? parseFloat(weight) : null
      const diff = prevWeight !== null && weightNum !== null ? weightNum - prevWeight : null
      if (weightNum !== null) prevWeight = weightNum

      const parts: string[] = []
      if (weightNum !== null) parts.push(`${weightNum} kg`)
      const bodyFat = c.values?.body_fat ?? c.values?.postotak_masnoce ?? null
      if (bodyFat !== null) parts.push(`${bodyFat}% ${t('tl_fat_pct')}`)

      all.push({
        id: `ci-${c.id}`,
        date: c.date,
        type: 'checkin',
        title: t('tl_weekly_checkin'),
        subtitle: parts.join('  ·  ') || (c.trainer_comment ? t('tl_trainer_comment_arrow') : undefined),
        meta: diff !== null
          ? diff > 0 ? `+${diff.toFixed(1)} kg`
            : diff < 0 ? `${diff.toFixed(1)} kg`
            : '±0 kg'
          : undefined,
        metaPositive: diff !== null ? diff <= 0 : undefined,
        color: TYPE_CONFIG.checkin.color,
        emoji: TYPE_CONFIG.checkin.emoji,
      })
    })

    // Packages + payments
    ;(packages ?? []).forEach((pkg: any) => {
      const pkgName = pkg.packages?.name ?? t('tl_pkg_default')
      const pkgColor = pkg.packages?.color ?? '#0891b2'
      all.push({
        id: `pkg-${pkg.id}`,
        date: pkg.start_date,
        type: 'package',
        title: pkgName,
        subtitle: pkg.status === 'active' ? t('tl_pkg_status_active') : pkg.status === 'expired' ? t('tl_pkg_status_expired') : pkg.status,
        color: pkgColor,
        emoji: TYPE_CONFIG.package.emoji,
      })
      const payment = (pkg.payments as any[])?.[0]
      if (payment?.status === 'paid' && payment?.paid_at) {
        all.push({
          id: `pay-${pkg.id}`,
          date: payment.paid_at.split('T')[0],
          type: 'payment',
          title: `${t('tl_payment_title')} — ${pkgName}`,
          subtitle: `${payment.amount ?? pkg.price} €`,
          color: TYPE_CONFIG.payment.color,
          emoji: TYPE_CONFIG.payment.emoji,
        })
      }
    })

    // Workout plans
    ;(workoutPlans ?? []).forEach((wp: any) => {
      all.push({
        id: `wp-${wp.id}`,
        date: (wp.assigned_at ?? '').split('T')[0],
        type: 'workout_plan',
        title: t('tl_wp_assigned'),
        subtitle: (wp.workout_plan as any)?.name ?? t('tl_wp_default'),
        color: TYPE_CONFIG.workout_plan.color,
        emoji: TYPE_CONFIG.workout_plan.emoji,
      })
    })

    // Meal plans
    ;(mealPlans ?? []).forEach((mp: any) => {
      all.push({
        id: `mp-${mp.id}`,
        date: (mp.assigned_at ?? '').split('T')[0],
        type: 'meal_plan',
        title: t('tl_mp_assigned'),
        subtitle: (mp.meal_plan as any)?.name ?? t('tl_mp_default'),
        color: TYPE_CONFIG.meal_plan.color,
        emoji: TYPE_CONFIG.meal_plan.emoji,
      })
    })

    all.sort((a, b) => b.date.localeCompare(a.date))
    setTotalEvents(all.length)
    buildGroups(all)
    setLoading(false)
  }

  const buildGroups = (events: TimelineEvent[], filter: EventType | 'all' = 'all') => {
    const filtered = filter === 'all' ? events : events.filter(e => e.type === filter)
    const map = new Map<string, TimelineEvent[]>()
    for (const ev of filtered) {
      const key = getMonthKey(ev.date)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(ev)
    }
    setGroups(
      Array.from(map.entries())
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([monthKey, evs]) => ({ monthKey, events: evs })),
    )
  }

  const handleFilter = (filter: EventType | 'all') => {
    setActiveFilter(filter)
    // Re-run only client-side filtering — refetch not needed
    // We need to store raw events for filtering
  }

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#7c3aed" />
      </View>
    )
  }

  const FILTERS: { key: EventType | 'all'; label: string }[] = [
    { key: 'all',          label: t('tl_filter_all_label') },
    { key: 'checkin',      label: t('tl_checkin') },
    { key: 'workout_plan', label: t('tab_training') },
    { key: 'meal_plan',    label: t('tab_nutrition') },
    { key: 'package',      label: t('tl_package') },
  ]

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <View style={styles.backBtnInner}>
            <Text style={styles.backArrow}>‹</Text>
            <Text style={styles.backText}>{t('back')}</Text>
          </View>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('tl_title')}</Text>
        <Text style={styles.headerSub}>{t('tl_subtitle')}</Text>
      </View>

      {groups.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>📅</Text>
          <Text style={styles.emptyTitle}>{t('tl_empty_title')}</Text>
          <Text style={styles.emptySub}>{t('tl_empty_sub')}</Text>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {/* Filter chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterBar}
          >
            {FILTERS.map(f => (
              <TouchableOpacity
                key={f.key}
                style={[styles.filterChip, activeFilter === f.key && styles.filterChipActive]}
                onPress={() => setActiveFilter(f.key)}
                activeOpacity={0.8}
              >
                <Text style={[styles.filterChipText, activeFilter === f.key && styles.filterChipTextActive]}>
                  {f.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {groups.map(group => {
              const eventsToShow = activeFilter === 'all'
                ? group.events
                : group.events.filter(e => e.type === activeFilter)
              if (eventsToShow.length === 0) return null
              return (
                <View key={group.monthKey}>
                  <Text style={styles.monthLabel}>{monthLabel(group.monthKey)}</Text>
                  {eventsToShow.map((ev, i) => (
                    <EventRow key={ev.id} event={ev} isLast={i === eventsToShow.length - 1} />
                  ))}
                </View>
              )
            })}
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      )}
    </View>
  )
}

function EventRow({ event, isLast }: { event: TimelineEvent; isLast: boolean }) {
  return (
    <View style={rowStyles.row}>
      {/* Left: dot + line */}
      <View style={rowStyles.left}>
        <View style={[rowStyles.dot, { backgroundColor: event.color }]}>
          <Text style={rowStyles.dotEmoji}>{event.emoji}</Text>
        </View>
        {!isLast && <View style={rowStyles.line} />}
      </View>

      {/* Right: content */}
      <View style={rowStyles.content}>
        <View style={rowStyles.topRow}>
          <Text style={rowStyles.title}>{event.title}</Text>
          {event.meta != null && (
            <View style={[
              rowStyles.metaBadge,
              { backgroundColor: event.metaPositive ? '#dcfce7' : '#fee2e2' },
            ]}>
              <Text style={[
                rowStyles.metaText,
                { color: event.metaPositive ? '#15803d' : '#991b1b' },
              ]}>
                {event.meta}
              </Text>
            </View>
          )}
        </View>
        {event.subtitle && (
          <Text style={rowStyles.subtitle} numberOfLines={2}>{event.subtitle}</Text>
        )}
        <Text style={rowStyles.date}>{formatDate(event.date)}</Text>
      </View>
    </View>
  )
}

const rowStyles = StyleSheet.create({
  row: { flexDirection: 'row', paddingRight: 20, marginBottom: 2 },
  left: { width: 44, alignItems: 'center' },
  dot: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12, shadowRadius: 4, elevation: 2,
  },
  dotEmoji: { fontSize: 12, fontWeight: '800', color: 'white', letterSpacing: 0.3 },
  line: { flex: 1, width: 2, backgroundColor: '#e5e7eb', minHeight: 24, marginTop: 2 },
  content: {
    flex: 1, backgroundColor: 'white', borderRadius: 16,
    padding: 14, marginLeft: 10, marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
  },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  title: { fontSize: 14, fontWeight: '700', color: '#111827', flex: 1, marginBottom: 2 },
  metaBadge: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 },
  metaText: { fontSize: 11, fontWeight: '700' },
  subtitle: { fontSize: 13, color: '#6b7280', lineHeight: 18, marginBottom: 4 },
  date: { fontSize: 11, color: '#9ca3af', fontWeight: '500', marginTop: 2 },
})

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f3f4f6' },

  header: {
    backgroundColor: '#1e1b4b',
    paddingTop: Platform.OS === 'ios' ? 60 : 44,
    paddingHorizontal: 20,
    paddingBottom: 26,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  backBtn: { marginBottom: 14, alignSelf: 'flex-start' },
  backBtnInner: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 99, paddingHorizontal: 14, paddingVertical: 8,
  },
  backArrow: { fontSize: 22, color: 'white', lineHeight: 26, fontWeight: '300' },
  backText: { fontSize: 14, color: 'white', fontWeight: '600' },
  headerTitle: { fontSize: 28, fontWeight: '800', color: 'white', marginBottom: 4 },
  headerSub: { fontSize: 13, color: 'rgba(255,255,255,0.55)' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyEmoji: { fontSize: 28, marginBottom: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 8 },
  emptySub: { fontSize: 14, color: '#9ca3af', textAlign: 'center', lineHeight: 22 },

  filterBar: {
    paddingHorizontal: 16, paddingVertical: 12, gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: 'white', borderRadius: 99,
    borderWidth: 1.5, borderColor: '#e5e7eb',
  },
  filterChipActive: { backgroundColor: '#1e1b4b', borderColor: '#1e1b4b' },
  filterChipText: { fontSize: 12, fontWeight: '600', color: '#6b7280' },
  filterChipTextActive: { color: 'white' },

  list: { paddingTop: 8, paddingLeft: 16 },
  monthLabel: {
    fontSize: 12, fontWeight: '700', color: '#9ca3af',
    letterSpacing: 0.8, textTransform: 'uppercase',
    marginBottom: 14, marginTop: 8, paddingLeft: 4,
  },
})
