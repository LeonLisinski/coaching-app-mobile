import { supabase } from '@/lib/supabase'
import { useLanguage } from '@/lib/LanguageContext'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator, Dimensions, Platform, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native'
import Svg, { Rect, Text as SvgText, Line } from 'react-native-svg'

type SetLog = {
  set_number: number
  reps: string
  weight: string
  completed: boolean
}

type ExerciseLog = {
  exercise_id: string
  name: string
  sets: SetLog[]
}

type WorkoutLog = {
  id: string
  date: string
  day_name: string
  exercises: ExerciseLog[]
}

type DayGroup = {
  dayName: string
  sessions: WorkoutLog[]
}

function formatDate(dateStr: string, locale = 'hr'): string {
  return new Date(dateStr).toLocaleDateString(locale, {
    day: 'numeric', month: 'long', year: 'numeric',
  })
}

function getCompletedSets(sets: SetLog[]): SetLog[] {
  return sets.filter(s => s.completed && (s.reps || s.weight))
}

function getMaxWeight(sets: SetLog[]): number {
  const done = getCompletedSets(sets)
  if (done.length === 0) return 0
  return Math.max(...done.map(s => parseFloat(s.weight) || 0))
}

function getAvgWeight(sets: SetLog[]): number {
  const done = getCompletedSets(sets)
  if (done.length === 0) return 0
  return done.reduce((sum, s) => sum + (parseFloat(s.weight) || 0), 0) / done.length
}

function formatWeightsList(sets: SetLog[]): string {
  const done = getCompletedSets(sets)
  if (done.length === 0) return '—'
  const weights = done.map(s => s.weight || '0')
  // Compact form: if all same → "4 × 80 kg", else list
  const unique = [...new Set(weights)]
  if (unique.length === 1) return `${done.length} × ${unique[0]} kg`
  return weights.join(' / ') + ' kg'
}

type Trend = 'up' | 'down' | 'same' | 'new'

function computeTrend(current: number, previous: number | undefined): Trend {
  if (previous === undefined) return 'new'
  const diff = current - previous
  if (diff > 0.4) return 'up'
  if (diff < -0.4) return 'down'
  return 'same'
}

// Per-exercise, build a map: exercise_id → avg weight across sessions in order
function buildPrevWeights(sessions: WorkoutLog[], currentIndex: number): Record<string, number> {
  const prev: Record<string, number> = {}
  if (currentIndex >= sessions.length - 1) return prev
  const prevSession = sessions[currentIndex + 1]
  for (const ex of prevSession.exercises) {
    const avg = getAvgWeight(ex.sets)
    if (avg > 0) prev[ex.exercise_id] = avg
  }
  return prev
}

// ── Trend Badge ───────────────────────────────────────────────────────────────
function TrendBadge({ trend, diff, t }: { trend: Trend; diff?: number; t: (k: string) => string }) {
  if (trend === 'new') {
    return (
      <View style={trendStyles.newBadge}>
        <Text style={trendStyles.newText}>{t('wh_first_session')}</Text>
      </View>
    )
  }
  if (trend === 'up') {
    const label = diff && diff > 0 ? `+${diff.toFixed(1)} kg` : '↑'
    return (
      <View style={trendStyles.upBadge}>
        <Text style={trendStyles.upText}>↑ {label}</Text>
      </View>
    )
  }
  if (trend === 'down') {
    const label = diff ? `${diff.toFixed(1)} kg` : '↓'
    return (
      <View style={trendStyles.downBadge}>
        <Text style={trendStyles.downText}>↓ {label}</Text>
      </View>
    )
  }
  return (
    <View style={trendStyles.sameBadge}>
      <Text style={trendStyles.sameText}>→</Text>
    </View>
  )
}

const trendStyles = StyleSheet.create({
  newBadge: { backgroundColor: '#eff6ff', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 },
  newText: { fontSize: 11, color: '#3b82f6', fontWeight: '600' },
  upBadge: { backgroundColor: '#dcfce7', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 },
  upText: { fontSize: 11, color: '#15803d', fontWeight: '700' },
  downBadge: { backgroundColor: '#fee2e2', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 },
  downText: { fontSize: 11, color: '#dc2626', fontWeight: '700' },
  sameBadge: { backgroundColor: '#f3f4f6', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 },
  sameText: { fontSize: 11, color: '#9ca3af', fontWeight: '700' },
})

// ── Session Card ──────────────────────────────────────────────────────────────
function SessionCard({
  session, prevWeights, sessionNumber, t, locale,
}: {
  session: WorkoutLog
  prevWeights: Record<string, number>
  sessionNumber: number
  t: (k: string) => string
  locale: string
}) {
  const [expanded, setExpanded] = useState(sessionNumber === 0)

  const totalCompleted = session.exercises.reduce(
    (sum, ex) => sum + getCompletedSets(ex.sets).length, 0,
  )
  const totalExercises = session.exercises.length

  return (
    <View style={sessionStyles.card}>
      <TouchableOpacity
        style={sessionStyles.header}
        onPress={() => setExpanded(e => !e)}
        activeOpacity={0.75}
      >
        <View style={sessionStyles.headerLeft}>
          <Text style={sessionStyles.dateText}>{formatDate(session.date, locale)}</Text>
          <Text style={sessionStyles.metaText}>
            {totalExercises} {t('wh_exercises')}  ·  {totalCompleted} {t('wh_sets')}
          </Text>
        </View>
        <Text style={sessionStyles.chevron}>{expanded ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={sessionStyles.body}>
          {session.exercises.map((ex, i) => {
            const done = getCompletedSets(ex.sets)
            if (done.length === 0) return null

            const currentAvg = getAvgWeight(ex.sets)
            const prevAvg = prevWeights[ex.exercise_id]
            const trend = computeTrend(currentAvg, prevAvg)
            const diff = prevAvg !== undefined ? currentAvg - prevAvg : undefined

            return (
              <View
                key={ex.exercise_id + i}
                style={[
                  sessionStyles.exerciseRow,
                  i < session.exercises.length - 1 && sessionStyles.exerciseRowBorder,
                ]}
              >
                <View style={sessionStyles.exerciseLeft}>
                  <View style={sessionStyles.exerciseNumBadge}>
                    <Text style={sessionStyles.exerciseNum}>{i + 1}</Text>
                  </View>
                  <View style={sessionStyles.exerciseInfo}>
                    <Text style={sessionStyles.exerciseName}>{ex.name}</Text>
                    <Text style={sessionStyles.exerciseSets}>{formatWeightsList(ex.sets)}</Text>
                  </View>
                </View>
                <TrendBadge trend={trend} diff={diff} t={t} />
              </View>
            )
          })}
        </View>
      )}
    </View>
  )
}

const sessionStyles = StyleSheet.create({
  card: {
    backgroundColor: 'white', borderRadius: 16,
    marginBottom: 10, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  headerLeft: { flex: 1 },
  dateText: { fontSize: 14, fontWeight: '700', color: '#111827' },
  metaText: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  chevron: { fontSize: 12, color: '#9ca3af', marginLeft: 8 },

  body: { borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  exerciseRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 11,
  },
  exerciseRowBorder: { borderBottomWidth: 1, borderBottomColor: '#f9fafb' },
  exerciseLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, marginRight: 8 },
  exerciseNumBadge: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center',
  },
  exerciseNum: { fontSize: 12, fontWeight: '700', color: '#3b82f6' },
  exerciseInfo: { flex: 1 },
  exerciseName: { fontSize: 14, fontWeight: '600', color: '#111827' },
  exerciseSets: { fontSize: 12, color: '#6b7280', marginTop: 2 },
})

// ── Day Group ─────────────────────────────────────────────────────────────────
function DayGroupSection({ group, t, locale }: { group: DayGroup; t: (k: string) => string; locale: string }) {
  const [collapsed, setCollapsed] = useState(false)
  const latest = group.sessions[0]
  const latestDate = latest ? formatDate(latest.date, locale) : ''

  return (
    <View style={groupStyles.container}>
      <TouchableOpacity
        style={groupStyles.header}
        onPress={() => setCollapsed(c => !c)}
        activeOpacity={0.8}
      >
        <View style={groupStyles.headerLeft}>
          <View style={groupStyles.dot} />
          <View>
            <Text style={groupStyles.dayName}>{group.dayName}</Text>
            <Text style={groupStyles.dayMeta}>
              {t('wh_day_meta').replace('{n}', String(group.sessions.length)).replace('{date}', latestDate)}
            </Text>
          </View>
        </View>
        <View style={groupStyles.countBadge}>
          <Text style={groupStyles.countText}>{group.sessions.length}</Text>
        </View>
      </TouchableOpacity>

      {!collapsed && (
        <View style={groupStyles.sessions}>
          {group.sessions.map((session, index) => (
            <SessionCard
              key={session.id}
              session={session}
              prevWeights={buildPrevWeights(group.sessions, index)}
              sessionNumber={index}
              t={t}
              locale={locale}
            />
          ))}
        </View>
      )}
    </View>
  )
}

const groupStyles = StyleSheet.create({
  container: { marginHorizontal: 16, marginBottom: 8 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: 4,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#3b82f6' },
  dayName: { fontSize: 16, fontWeight: '700', color: '#111827' },
  dayMeta: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  countBadge: {
    backgroundColor: '#eff6ff', borderRadius: 99,
    paddingHorizontal: 10, paddingVertical: 4, minWidth: 32, alignItems: 'center',
  },
  countText: { fontSize: 13, fontWeight: '700', color: '#3b82f6' },
  sessions: {},
})

// ── PR Tracking ───────────────────────────────────────────────────────────────
type PrRecord = {
  exerciseId: string
  name: string
  maxWeight: number
  maxReps: number
  date: string
  sets: string
  isNew?: boolean  // PR within last 30 days
}

function buildPRs(groups: DayGroup[]): PrRecord[] {
  const map = new Map<string, PrRecord>()
  const allSessions: WorkoutLog[] = groups.flatMap(g => g.sessions)

  for (const session of allSessions) {
    for (const ex of session.exercises) {
      const done = getCompletedSets(ex.sets)
      if (done.length === 0) continue
      const maxW = Math.max(...done.map(s => parseFloat(s.weight) || 0))
      const maxR = Math.max(...done.map(s => parseInt(s.reps) || 0))

      const existing = map.get(ex.exercise_id ?? ex.name)
      if (!existing || maxW > existing.maxWeight) {
        map.set(ex.exercise_id ?? ex.name, {
          exerciseId: ex.exercise_id ?? ex.name,
          name: ex.name,
          maxWeight: maxW,
          maxReps: maxR,
          date: session.date,
          sets: formatWeightsList(ex.sets),
        })
      }
    }
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const result = Array.from(map.values())
    .filter(r => r.maxWeight > 0)
    .sort((a, b) => a.name.localeCompare(b.name))

  return result.map(r => ({ ...r, isNew: r.date >= thirtyDaysAgo }))
}

function PRsView({ groups, t, locale }: { groups: DayGroup[]; t: (k: string) => string; locale: string }) {
  const prs = useMemo(() => buildPRs(groups), [groups])

  if (prs.length === 0) {
    return (
      <View style={prStyles.empty}>
        <Text style={prStyles.emptyText}>{t('wh_pr_empty')}</Text>
      </View>
    )
  }

  return (
    <ScrollView contentContainerStyle={prStyles.list} showsVerticalScrollIndicator={false}>
      <Text style={prStyles.sectionLabel}>{t('wh_pr_section').replace('{n}', String(prs.length))}</Text>
      {prs.map((pr, i) => (
        <View key={pr.exerciseId} style={prStyles.row}>
          <View style={prStyles.rankBadge}>
            <Text style={prStyles.rankText}>{i + 1}</Text>
          </View>
          <View style={prStyles.info}>
            <View style={prStyles.nameRow}>
              <Text style={prStyles.exName} numberOfLines={1}>{pr.name}</Text>
              {pr.isNew && (
                <View style={prStyles.newBadge}>
                  <Text style={prStyles.newBadgeText}>🔥 PR</Text>
                </View>
              )}
            </View>
            <Text style={prStyles.exSets}>{pr.sets}</Text>
            <Text style={prStyles.exDate}>{formatDate(pr.date, locale)}</Text>
          </View>
          <View style={prStyles.weightBox}>
            <Text style={prStyles.weightNum}>{pr.maxWeight}</Text>
            <Text style={prStyles.weightUnit}>kg</Text>
          </View>
        </View>
      ))}
      <View style={{ height: 40 }} />
    </ScrollView>
  )
}

const prStyles = StyleSheet.create({
  list: { paddingTop: 22, paddingBottom: 32 },
  empty: { flex: 1, alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: 14, color: '#9ca3af' },
  sectionLabel: {
    fontSize: 10, fontWeight: '700', color: '#9ca3af',
    letterSpacing: 0.8, textTransform: 'uppercase',
    paddingHorizontal: 20, marginBottom: 12,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: 'white',
    borderRadius: 16, marginHorizontal: 16, marginBottom: 8,
    paddingVertical: 14, paddingHorizontal: 14, gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
  },
  rankBadge: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center',
  },
  rankText: { fontSize: 13, fontWeight: '800', color: '#3b82f6' },
  info: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  exName: { fontSize: 14, fontWeight: '700', color: '#111827', flex: 1 },
  newBadge: { backgroundColor: '#fef3c7', borderRadius: 99, paddingHorizontal: 7, paddingVertical: 2 },
  newBadgeText: { fontSize: 10, fontWeight: '700', color: '#92400e' },
  exSets: { fontSize: 12, color: '#6b7280' },
  exDate: { fontSize: 11, color: '#9ca3af', marginTop: 1 },
  weightBox: { alignItems: 'center' },
  weightNum: { fontSize: 22, fontWeight: '800', color: '#1e3a5f' },
  weightUnit: { fontSize: 11, color: '#9ca3af', fontWeight: '600' },
})

// ── Volume Chart ───────────────────────────────────────────────────────────────
const SCREEN_W = Dimensions.get('window').width
const BAR_CHART_W = SCREEN_W - 32
const BAR_CHART_H = 160

type VolumePoint = { date: string; volume: number; label: string }

function sessionVolume(log: WorkoutLog): number {
  return log.exercises.reduce((sum, ex) => {
    const done = getCompletedSets(ex.sets)
    return sum + done.reduce((s, set) => {
      const w = parseFloat(set.weight) || 0
      const r = parseInt(set.reps) || 0
      // Only count if BOTH weight and reps are entered
      return s + (w > 0 && r > 0 ? w * r : 0)
    }, 0)
  }, 0)
}

function hasActualVolume(log: WorkoutLog): boolean {
  return sessionVolume(log) > 0
}

function VolumeChart({ points, color = '#3b82f6' }: { points: VolumePoint[]; color?: string }) {
  if (points.length === 0) return null

  const maxV = Math.max(...points.map(p => p.volume), 1)
  const barW = Math.floor((BAR_CHART_W - 40) / Math.min(points.length, 20)) - 3
  const visiblePoints = points.slice(-20)

  return (
    <View style={{ overflow: 'hidden' }}>
      <Svg width={BAR_CHART_W} height={BAR_CHART_H + 28}>
        {/* Grid */}
        {[0.25, 0.5, 0.75, 1].map(pct => {
          const y = BAR_CHART_H - (BAR_CHART_H - 16) * pct + 8
          return (
            <Line
              key={pct}
              x1={0} y1={y}
              x2={BAR_CHART_W} y2={y}
              stroke="#f3f4f6" strokeWidth={1}
            />
          )
        })}

        {visiblePoints.map((p, i) => {
          const barH = Math.max(4, Math.round(((BAR_CHART_H - 24) * p.volume) / maxV))
          const x = i * (barW + 3) + 20
          const y = BAR_CHART_H - barH
          return (
            <Rect
              key={p.date}
              x={x}
              y={y}
              width={barW}
              height={barH}
              rx={4}
              fill={color}
              opacity={0.85}
            />
          )
        })}

        {/* X-axis labels (every ~4 bars) */}
        {visiblePoints.map((p, i) => {
          if (i % Math.ceil(visiblePoints.length / 5) !== 0) return null
          const x = i * (barW + 3) + 20 + barW / 2
          return (
            <SvgText
              key={`lbl-${p.date}`}
              x={x}
              y={BAR_CHART_H + 18}
              fontSize={9}
              fill="#9ca3af"
              textAnchor="middle"
            >
              {p.label}
            </SvgText>
          )
        })}
      </Svg>
    </View>
  )
}

function VolumeView({ groups }: { groups: DayGroup[] }) {
  const { t } = useLanguage()
  const DAY_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#ef4444']

  const allSessions = useMemo(
    () => groups
      .flatMap(g => g.sessions)
      .sort((a, b) => a.date.localeCompare(b.date))
      .filter(hasActualVolume),
    [groups],
  )

  const totalVolume = useMemo(
    () => allSessions.reduce((s, log) => s + sessionVolume(log), 0),
    [allSessions],
  )

  // Overall volume points — only sessions with actual data
  const overallPoints: VolumePoint[] = allSessions.map(s => ({
    date: s.date,
    volume: sessionVolume(s),
    label: s.date.slice(5).replace('-', '.'),
  }))

  return (
    <ScrollView contentContainerStyle={volStyles.list} showsVerticalScrollIndicator={false}>
      {/* Total volume card */}
      <View style={volStyles.summaryCard}>
        <Text style={volStyles.summaryLabel}>{t('wh_total_vol')}</Text>
        <Text style={volStyles.summaryNum}>
          {totalVolume >= 1000 ? `${(totalVolume / 1000).toFixed(1)}k` : Math.round(totalVolume)}
        </Text>
        <Text style={volStyles.summaryUnit}>{t('wh_total_vol_unit')}</Text>
        <Text style={volStyles.summaryMeta}>{allSessions.length} {t('wh_stat_sessions')}</Text>
      </View>

      {/* Overall chart */}
      {overallPoints.length > 1 && (
        <View style={volStyles.chartCard}>
          <Text style={volStyles.chartTitle}>{t('wh_volume_per_session')}</Text>
          <Text style={volStyles.chartSub}>{t('wh_last_n_sessions').replace('{n}', String(Math.min(overallPoints.length, 20)))}</Text>
          <VolumeChart points={overallPoints} color="#3b82f6" />
        </View>
      )}

      {/* Per day type */}
      <Text style={volStyles.sectionLabel}>{t('wh_by_day_type')}</Text>
      {groups.map((group, gi) => {
        const color = DAY_COLORS[gi % DAY_COLORS.length]
        const dayPoints: VolumePoint[] = group.sessions
          .slice().reverse()
          .filter(hasActualVolume)
          .map(s => ({
            date: s.date,
            volume: sessionVolume(s),
            label: s.date.slice(5).replace('-', '.'),
          }))
        const avgVol = dayPoints.length > 0
          ? dayPoints.reduce((s, p) => s + p.volume, 0) / dayPoints.length
          : 0

        return (
          <View key={group.dayName} style={volStyles.dayCard}>
            <View style={volStyles.dayCardHeader}>
              <View style={[volStyles.dayDot, { backgroundColor: color }]} />
              <Text style={volStyles.dayName}>{group.dayName}</Text>
              <Text style={volStyles.dayAvg}>
                ⌀ {avgVol >= 1000 ? `${(avgVol / 1000).toFixed(1)}k` : Math.round(avgVol)} kg
              </Text>
            </View>
            {dayPoints.length > 1 && (
              <VolumeChart points={dayPoints} color={color} />
            )}
            {dayPoints.length === 1 && (
              <View style={volStyles.singleSession}>
                <Text style={volStyles.singleText}>
                  {t('wh_single_session')}  ·  {Math.round(dayPoints[0].volume)} kg
                </Text>
              </View>
            )}
          </View>
        )
      })}
      <View style={{ height: 40 }} />
    </ScrollView>
  )
}

const volStyles = StyleSheet.create({
  list: { paddingTop: 20, paddingBottom: 32 },
  summaryCard: {
    backgroundColor: '#1e3a5f', borderRadius: 20,
    marginHorizontal: 16, marginBottom: 16,
    padding: 22, alignItems: 'center',
  },
  summaryLabel: { fontSize: 12, color: 'rgba(255,255,255,0.6)', fontWeight: '600', marginBottom: 6 },
  summaryNum: { fontSize: 42, fontWeight: '900', color: 'white', lineHeight: 48 },
  summaryUnit: { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 4 },
  summaryMeta: { fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 2 },
  chartCard: {
    backgroundColor: 'white', borderRadius: 20, marginHorizontal: 16,
    marginBottom: 16, padding: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 10, elevation: 2,
  },
  chartTitle: { fontSize: 14, fontWeight: '700', color: '#111827', marginBottom: 2 },
  chartSub: { fontSize: 12, color: '#9ca3af', marginBottom: 14 },
  sectionLabel: {
    fontSize: 10, fontWeight: '700', color: '#9ca3af',
    letterSpacing: 0.8, textTransform: 'uppercase',
    paddingHorizontal: 20, marginBottom: 12, marginTop: 4,
  },
  dayCard: {
    backgroundColor: 'white', borderRadius: 20, marginHorizontal: 16,
    marginBottom: 12, padding: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
  },
  dayCardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14,
  },
  dayDot: { width: 10, height: 10, borderRadius: 5 },
  dayName: { fontSize: 14, fontWeight: '700', color: '#111827', flex: 1 },
  dayAvg: { fontSize: 12, color: '#6b7280', fontWeight: '600' },
  singleSession: {
    backgroundColor: '#f9fafb', borderRadius: 10, padding: 12, alignItems: 'center',
  },
  singleText: { fontSize: 13, color: '#9ca3af' },
})

// ── Main Screen ───────────────────────────────────────────────────────────────
type TabMode = 'sessions' | 'prs' | 'volume'

export default function WorkoutHistoryScreen() {
  const { t, lang } = useLanguage()
  const locale = lang === 'en' ? 'en' : 'hr'
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [groups, setGroups] = useState<DayGroup[]>([])
  const [totalSessions, setTotalSessions] = useState(0)
  const [totalSets, setTotalSets] = useState(0)
  const [tab, setTab] = useState<TabMode>('sessions')

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: client } = await supabase
      .from('clients').select('id, trainer_id')
      .eq('user_id', user.id).single()
    if (!client) { setLoading(false); return }

    const { data: logs } = await supabase
      .from('workout_logs')
      .select('id, date, day_name, exercises')
      .eq('client_id', client.id)
      .order('date', { ascending: false })
      .limit(200)

    if (!logs) { setLoading(false); return }

    const map: Record<string, WorkoutLog[]> = {}
    for (const log of logs) {
      if (!map[log.day_name]) map[log.day_name] = []
      map[log.day_name].push(log)
    }

    const grouped: DayGroup[] = Object.entries(map)
      .map(([dayName, sessions]) => ({ dayName, sessions }))
      .sort((a, b) =>
        new Date(b.sessions[0].date).getTime() - new Date(a.sessions[0].date).getTime(),
      )

    const totalS = logs.reduce(
      (sum, log) =>
        sum + log.exercises.reduce(
          (s: number, ex: ExerciseLog) => s + getCompletedSets(ex.sets).length, 0,
        ), 0,
    )

    setGroups(grouped)
    setTotalSessions(logs.length)
    setTotalSets(totalS)
    setLoading(false)
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    )
  }

  const TABS: { key: TabMode; label: string }[] = [
    { key: 'sessions', label: t('wh_tab_sessions') },
    { key: 'prs',      label: t('wh_tab_prs') },
    { key: 'volume',   label: t('wh_tab_volume') },
  ]

  return (
    <View style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <View style={styles.backBtnInner}>
            <Text style={styles.backArrow}>‹</Text>
            <Text style={styles.backText}>{t('tab_training')}</Text>
          </View>
        </TouchableOpacity>

        <Text style={styles.headerTitle}>{t('wh_title')}</Text>

        {totalSessions > 0 && (
          <View style={styles.statsRow}>
            <View style={styles.statCell}>
              <Text style={styles.statNum}>{totalSessions}</Text>
              <Text style={styles.statLabel}>{t('wh_stat_sessions')}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCell}>
              <Text style={styles.statNum}>{groups.length}</Text>
              <Text style={styles.statLabel}>{t('wh_stat_days')}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCell}>
              <Text style={styles.statNum}>{totalSets}</Text>
              <Text style={styles.statLabel}>{t('wh_sets')}</Text>
            </View>
          </View>
        )}
      </View>

      {/* Empty state */}
      {groups.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyEmoji}>💪</Text>
          <Text style={styles.emptyTitle}>{t('wh_empty_title')}</Text>
          <Text style={styles.emptySub}>{t('wh_empty_sub')}</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.emptyBtn}>
            <Text style={styles.emptyBtnText}>{t('tab_training')} →</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {/* Tabs */}
          <View style={styles.tabs}>
            {TABS.map(tabItem => (
              <TouchableOpacity
                key={tabItem.key}
                style={[styles.tab, tab === tabItem.key && styles.tabActive]}
                onPress={() => setTab(tabItem.key)}
                activeOpacity={0.8}
              >
                <Text style={[styles.tabText, tab === tabItem.key && styles.tabTextActive]}>
                  {tabItem.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {tab === 'sessions' && (
            <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
              <Text style={styles.sectionLabel}>
                {t('wh_grouped_by_day').replace('{n}', String(totalSessions))}
              </Text>
              {groups.map(group => (
                <DayGroupSection key={group.dayName} group={group} t={t} locale={locale} />
              ))}
              <View style={{ height: 40 }} />
            </ScrollView>
          )}

          {tab === 'prs' && <PRsView groups={groups} t={t} locale={locale} />}
          {tab === 'volume' && <VolumeView groups={groups} />}
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  loadingContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f3f4f6',
  },

  header: {
    backgroundColor: '#1e3a5f',
    paddingTop: Platform.OS === 'ios' ? 60 : 44,
    paddingHorizontal: 20,
    paddingBottom: 26,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  backBtn: { marginBottom: 14, alignSelf: 'flex-start' },
  backBtnInner: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 99, paddingHorizontal: 14, paddingVertical: 8,
  },
  backArrow: { fontSize: 22, color: 'white', lineHeight: 26, fontWeight: '300' },
  backText: { fontSize: 14, color: 'white', fontWeight: '600' },
  headerTitle: { fontSize: 28, fontWeight: '800', color: 'white', marginBottom: 18 },

  statsRow: { flexDirection: 'row' },
  statCell: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 22, fontWeight: '800', color: 'white' },
  statLabel: { fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2, fontWeight: '500' },
  statDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: 2 },

  emptyContainer: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40,
  },
  emptyEmoji: { fontSize: 28, marginBottom: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 10 },
  emptySub: {
    fontSize: 14, color: '#9ca3af', textAlign: 'center', lineHeight: 22, marginBottom: 28,
  },
  emptyBtn: {
    backgroundColor: '#3b82f6', borderRadius: 14, paddingHorizontal: 24, paddingVertical: 13,
  },
  emptyBtnText: { color: 'white', fontSize: 15, fontWeight: '700' },

  list: { paddingTop: 22, paddingBottom: 32 },
  sectionLabel: {
    fontSize: 10, fontWeight: '700', color: '#9ca3af',
    letterSpacing: 0.8, textTransform: 'uppercase',
    paddingHorizontal: 20, marginBottom: 14,
  },

  tabs: {
    flexDirection: 'row', backgroundColor: 'white',
    borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 0, gap: 4,
  },
  tab: {
    flex: 1, alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 2.5, borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: '#3b82f6' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#9ca3af' },
  tabTextActive: { color: '#3b82f6' },
})
