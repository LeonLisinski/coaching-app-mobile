import { supabase } from '@/lib/supabase'
import { useLanguage } from '@/lib/LanguageContext'
import { useClient } from '@/lib/ClientContext'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator, Dimensions, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Defs, LinearGradient, Path, Stop, Circle, Line } from 'react-native-svg'

type Parameter = { id: string; name: string; unit: string | null; order_index: number }
type RawPoint = { date: string; value: number }

type RangeOpt = { label: string; days: number | null }
const RANGES: RangeOpt[] = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: 'Sve', days: null },
]

const GROUP_OPTIONS = ['Dnevno', 'Tjedno', 'Mjes.'] as const
type GroupMode = typeof GROUP_OPTIONS[number]

const CHART_COLORS = ['#3b82f6', '#f59e0b', '#22c55e', '#a855f7', '#ef4444', '#06b6d4', '#f97316', '#ec4899']
const { width: SCREEN_W } = Dimensions.get('window')
const CARD_PAD = 16
const YAXIS_W = 40
const CHART_W = SCREEN_W - CARD_PAD * 4 - YAXIS_W  // card margins + padding + y-axis
const CHART_H = 130
const PAD = { top: 8, bottom: 8 }
const INNER_H = CHART_H - PAD.top - PAD.bottom

// ── ISO week number ───────────────────────────────────────────────────────────
function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().split('T')[0]
}

function getMonthKey(dateStr: string): string {
  return dateStr.slice(0, 7)
}

// ── Group data points ─────────────────────────────────────────────────────────
function groupPoints(points: RawPoint[], mode: GroupMode): RawPoint[] {
  if (mode === 'Dnevno' || points.length === 0) return points
  const map: Record<string, number[]> = {}
  for (const p of points) {
    const key = mode === 'Tjedno' ? getWeekStart(p.date) : getMonthKey(p.date)
    if (!map[key]) map[key] = []
    map[key].push(p.value)
  }
  return Object.entries(map)
    .map(([date, vals]) => ({
      date,
      value: parseFloat((vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(2)),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// ── Format date for X-axis ────────────────────────────────────────────────────
function fmtLabel(dateStr: string, mode: GroupMode): string {
  if (mode === 'Mjes.') {
    const [, m] = dateStr.split('-')
    const months = ['', 'Sij', 'Velj', 'Ožu', 'Tra', 'Svi', 'Lip', 'Srp', 'Kol', 'Ruj', 'Lis', 'Stu', 'Pro']
    return months[parseInt(m)]
  }
  const d = new Date(dateStr)
  return `${d.getDate()}.${d.getMonth() + 1}.`
}

// ── Mini SVG Chart ────────────────────────────────────────────────────────────
function ParamChart({ param, points, color, gradId, group = 'Dnevno' }: {
  param: Parameter
  points: RawPoint[]
  color: string
  gradId: string
  group?: GroupMode
}) {
  if (points.length === 0) return (
    <View style={chartStyles.noData}>
      <Text style={chartStyles.noDataText}>Nema podataka za odabrani period</Text>
    </View>
  )

  const vals = points.map(p => p.value)
  const minVal = Math.min(...vals)
  const maxVal = Math.max(...vals)
  const latest = vals[vals.length - 1]
  const prev = vals.length >= 2 ? vals[vals.length - 2] : null
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length
  const diff = prev !== null ? latest - prev : null

  // Single data point → show big number
  if (points.length === 1) {
    return (
      <View style={chartStyles.singlePoint}>
        <Text style={[chartStyles.singleValue, { color }]}>
          {latest}
          {param.unit ? <Text style={chartStyles.singleUnit}> {param.unit}</Text> : null}
        </Text>
        <Text style={chartStyles.singleLabel}>Jedna mjera</Text>
      </View>
    )
  }

  const getX = (i: number) =>
    points.length <= 1 ? CHART_W / 2 : (i / (points.length - 1)) * CHART_W

  const getY = (v: number) => {
    if (maxVal === minVal) return PAD.top + INNER_H / 2
    return PAD.top + INNER_H - ((v - minVal) / (maxVal - minVal)) * INNER_H
  }

  const buildLine = () =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${getX(i).toFixed(1)},${getY(p.value).toFixed(1)}`).join(' ')

  const buildArea = () => {
    const bottom = PAD.top + INNER_H
    const linePath = points.map((p, i) =>
      `${i === 0 ? 'M' : 'L'}${getX(i).toFixed(1)},${getY(p.value).toFixed(1)}`
    ).join(' ')
    return `${linePath} L${getX(points.length - 1).toFixed(1)},${bottom} L0,${bottom} Z`
  }

  const showLabel = (i: number) =>
    points.length <= 5 || i === 0 || i === points.length - 1 ||
    i % Math.ceil(points.length / 4) === 0

  return (
    <View>
      {/* Y-axis + Chart */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ width: YAXIS_W, height: CHART_H, justifyContent: 'space-between', paddingVertical: PAD.top, alignItems: 'flex-end', paddingRight: 6 }}>
          <Text style={chartStyles.yLabel}>{maxVal % 1 === 0 ? maxVal : maxVal.toFixed(1)}</Text>
          <Text style={chartStyles.yLabel}>{avg % 1 === 0 ? avg.toFixed(0) : avg.toFixed(1)}</Text>
          <Text style={chartStyles.yLabel}>{minVal % 1 === 0 ? minVal : minVal.toFixed(1)}</Text>
        </View>

        <Svg width={CHART_W} height={CHART_H}>
          <Defs>
            <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={color} stopOpacity="0.2" />
              <Stop offset="100%" stopColor={color} stopOpacity="0" />
            </LinearGradient>
          </Defs>

          {/* Grid lines */}
          {[0, 0.5, 1].map((f, i) => (
            <Line
              key={i}
              x1={0} y1={PAD.top + f * INNER_H}
              x2={CHART_W} y2={PAD.top + f * INNER_H}
              stroke="#f3f4f6" strokeWidth="1"
            />
          ))}

          {/* Area fill */}
          <Path d={buildArea()} fill={`url(#${gradId})`} />

          {/* Line */}
          <Path
            d={buildLine()}
            fill="none" stroke={color} strokeWidth="2.5"
            strokeLinejoin="round" strokeLinecap="round"
          />

          {/* Dots */}
          {points.map((p, i) => (
            <Circle
              key={i}
              cx={getX(i)} cy={getY(p.value)}
              r={4.5} fill={color} stroke="white" strokeWidth="2"
            />
          ))}
        </Svg>
      </View>

      {/* X-axis labels */}
      <View style={{ flexDirection: 'row', paddingLeft: YAXIS_W }}>
        {points.map((p, i) => (
          <Text
            key={i}
            style={[chartStyles.xLabel, { flex: 1, opacity: showLabel(i) ? 1 : 0 }]}
          >
            {fmtLabel(p.date, group)}
          </Text>
        ))}
      </View>

      {/* Stats row */}
      <View style={chartStyles.statsRow}>
        <View style={chartStyles.statCell}>
          <Text style={chartStyles.statLabel}>Zadnje</Text>
          <Text style={[chartStyles.statValue, { color }]}>
            {latest}{param.unit ? ` ${param.unit}` : ''}
          </Text>
        </View>
        {diff !== null && (
          <View style={chartStyles.statCell}>
            <Text style={chartStyles.statLabel}>Promjena</Text>
            <Text style={[chartStyles.statValue, {
              color: diff < -0.05 ? '#22c55e' : diff > 0.05 ? '#ef4444' : '#6b7280',
            }]}>
              {diff > 0 ? '+' : ''}{diff.toFixed(1)}{param.unit ? ` ${param.unit}` : ''}
            </Text>
          </View>
        )}
        <View style={chartStyles.statCell}>
          <Text style={chartStyles.statLabel}>Prosjek</Text>
          <Text style={chartStyles.statValue}>{avg.toFixed(1)}{param.unit ? ` ${param.unit}` : ''}</Text>
        </View>
        <View style={chartStyles.statCell}>
          <Text style={chartStyles.statLabel}>Min</Text>
          <Text style={chartStyles.statValue}>{minVal}{param.unit ? ` ${param.unit}` : ''}</Text>
        </View>
        <View style={chartStyles.statCell}>
          <Text style={chartStyles.statLabel}>Max</Text>
          <Text style={chartStyles.statValue}>{maxVal}{param.unit ? ` ${param.unit}` : ''}</Text>
        </View>
      </View>
    </View>
  )
}

const chartStyles = StyleSheet.create({
  noData: { height: 80, alignItems: 'center', justifyContent: 'center' },
  noDataText: { color: '#d1d5db', fontSize: 13, fontStyle: 'italic' },
  singlePoint: { alignItems: 'center', paddingVertical: 20 },
  singleValue: { fontSize: 48, fontWeight: '800', letterSpacing: -1 },
  singleUnit: { fontSize: 22, fontWeight: '500' },
  singleLabel: { fontSize: 12, color: '#9ca3af', marginTop: 4 },
  yLabel: { fontSize: 10, color: '#9ca3af', fontWeight: '500' },
  xLabel: { fontSize: 9, color: '#9ca3af', textAlign: 'center' },
  statsRow: {
    flexDirection: 'row', marginTop: 12,
    paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f3f4f6',
  },
  statCell: { flex: 1, alignItems: 'center' },
  statLabel: { fontSize: 10, color: '#9ca3af', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 },
  statValue: { fontSize: 13, fontWeight: '700', color: '#111827' },
})

// ── Param Card ────────────────────────────────────────────────────────────────
function ParamCard({ param, allPoints, range, group, colorIndex }: {
  param: Parameter
  allPoints: RawPoint[]
  range: RangeOpt
  group: GroupMode
  colorIndex: number
}) {
  const color = CHART_COLORS[colorIndex % CHART_COLORS.length]
  const gradId = `grad-${param.id}`

  const filtered = useMemo(() => {
    if (!range.days) return allPoints
    const cutoff = new Date(Date.now() - range.days * 86400000).toISOString().split('T')[0]
    return allPoints.filter(p => p.date >= cutoff)
  }, [allPoints, range])

  const grouped = useMemo(() => groupPoints(filtered, group), [filtered, group])

  return (
    <View style={paramCardStyles.card}>
      <View style={paramCardStyles.cardHeader}>
        <View style={[paramCardStyles.colorDot, { backgroundColor: color }]} />
        <Text style={paramCardStyles.paramName}>{param.name}</Text>
        {param.unit && (
          <View style={paramCardStyles.unitBadge}>
            <Text style={paramCardStyles.unitText}>{param.unit}</Text>
          </View>
        )}
        <Text style={paramCardStyles.count}>{grouped.length} unosa</Text>
      </View>
      <ParamChart param={param} points={grouped} color={color} gradId={gradId} group={group} />
    </View>
  )
}

const paramCardStyles = StyleSheet.create({
  card: {
    backgroundColor: 'white', borderRadius: 20, marginHorizontal: 16,
    marginBottom: 14, padding: CARD_PAD,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  colorDot: { width: 10, height: 10, borderRadius: 5 },
  paramName: { fontSize: 15, fontWeight: '700', color: '#111827', flex: 1 },
  unitBadge: { backgroundColor: '#f3f4f6', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 },
  unitText: { fontSize: 11, fontWeight: '600', color: '#6b7280' },
  count: { fontSize: 11, color: '#9ca3af', fontWeight: '500' },
})

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function MetricsScreen() {
  const insets = useSafeAreaInsets()
  const { t } = useLanguage()
  const router = useRouter()
  const { clientData: ctxClient } = useClient()
  const [loading, setLoading] = useState(true)
  const [params, setParams] = useState<Parameter[]>([])
  const [rawData, setRawData] = useState<Record<string, RawPoint[]>>({})
  const [range, setRange] = useState<RangeOpt>(RANGES[2])   // default 90d
  const [group, setGroup] = useState<GroupMode>('Dnevno')

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    const client = ctxClient ? { id: ctxClient.clientId, trainer_id: ctxClient.trainerId } : null
    if (!client) { setLoading(false); return }

    const [{ data: paramData }, { data: checkinData }, { data: dailyData }] = await Promise.all([
      supabase.from('checkin_parameters')
        .select('id, name, unit, order_index')
        .eq('trainer_id', client.trainer_id)
        .eq('type', 'number')
        .order('order_index'),
      supabase.from('checkins')
        .select('date, values')
        .eq('client_id', client.id)
        .order('date', { ascending: true })
        .limit(365),
      supabase.from('daily_logs')
        .select('date, values')
        .eq('client_id', client.id)
        .order('date', { ascending: true })
        .limit(365),
    ])

    if (!paramData) { setLoading(false); return }
    setParams(paramData)

    // Merge checkins + daily_logs per parameter
    // For same date, checkins value takes precedence
    const merged: Record<string, Record<string, number>> = {}

    for (const log of (dailyData ?? [])) {
      if (!log.values) continue
      for (const param of paramData) {
        const v = log.values[param.id]
        if (v == null || v === '') continue
        const num = parseFloat(v)
        if (isNaN(num)) continue
        if (!merged[param.id]) merged[param.id] = {}
        merged[param.id][log.date] = num
      }
    }
    for (const ci of (checkinData ?? [])) {
      if (!ci.values) continue
      for (const param of paramData) {
        const v = ci.values[param.id]
        if (v == null || v === '') continue
        const num = parseFloat(v)
        if (isNaN(num)) continue
        if (!merged[param.id]) merged[param.id] = {}
        merged[param.id][ci.date] = num   // checkin overrides daily
      }
    }

    // Convert to sorted RawPoint arrays
    const result: Record<string, RawPoint[]> = {}
    for (const param of paramData) {
      result[param.id] = Object.entries(merged[param.id] ?? {})
        .map(([date, value]) => ({ date, value }))
        .sort((a, b) => a.date.localeCompare(b.date))
    }

    setRawData(result)
    setLoading(false)
  }

  const totalMeasurements = params.reduce(
    (sum, p) => sum + (rawData[p.id]?.length ?? 0), 0,
  )

  const paramsWithData = params.filter(p => (rawData[p.id]?.length ?? 0) > 0)

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <View style={styles.backBtnInner}>
            <Text style={styles.backArrow}>‹</Text>
            <Text style={styles.backText}>{t('back')}</Text>
          </View>
        </TouchableOpacity>

        <Text style={styles.headerTitle}>{t('met_title')}</Text>

        {totalMeasurements > 0 && (
          <View style={styles.statsRow}>
            <View style={styles.statCell}>
              <Text style={styles.statNum}>{paramsWithData.length}</Text>
              <Text style={styles.statLabel}>parametara</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCell}>
              <Text style={styles.statNum}>{totalMeasurements}</Text>
              <Text style={styles.statLabel}>ukupno mjera</Text>
            </View>
          </View>
        )}
      </View>

      {paramsWithData.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyEmoji}>📊</Text>
          <Text style={styles.emptyTitle}>{t('met_empty_title')}</Text>
          <Text style={styles.emptySub}>{t('met_empty_sub')}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>

          {/* Filters */}
          <View style={styles.filtersSection}>
            {/* Range pills */}
            <View style={styles.filterRow}>
              <Text style={styles.filterLabel}>Period</Text>
              <View style={styles.pills}>
                {RANGES.map(r => (
                  <TouchableOpacity
                    key={r.label}
                    style={[styles.pill, range.label === r.label && styles.pillActive]}
                    onPress={() => setRange(r)}
                  >
                    <Text style={[styles.pillText, range.label === r.label && styles.pillTextActive]}>
                      {r.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Group pills */}
            <View style={styles.filterRow}>
              <Text style={styles.filterLabel}>Grupiranje</Text>
              <View style={styles.pills}>
                {GROUP_OPTIONS.map(g => (
                  <TouchableOpacity
                    key={g}
                    style={[styles.pill, group === g && styles.pillActive]}
                    onPress={() => setGroup(g)}
                  >
                    <Text style={[styles.pillText, group === g && styles.pillTextActive]}>{g}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          {/* Chart cards */}
          {paramsWithData.map((param, i) => (
            <ParamCard
              key={param.id}
              param={param}
              allPoints={rawData[param.id] ?? []}
              range={range}
              group={group}
              colorIndex={i}
            />
          ))}

          <View style={{ height: 40 }} />
        </ScrollView>
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
    backgroundColor: '#4f46e5',
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
  emptySub: { fontSize: 14, color: '#9ca3af', textAlign: 'center', lineHeight: 22 },

  list: { paddingTop: 20, paddingBottom: 32 },

  filtersSection: {
    backgroundColor: 'white', borderRadius: 18, marginHorizontal: 16,
    marginBottom: 16, paddingHorizontal: 16, paddingVertical: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
    gap: 10,
  },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  filterLabel: {
    fontSize: 11, fontWeight: '700', color: '#9ca3af',
    textTransform: 'uppercase', letterSpacing: 0.6, width: 72,
  },
  pills: { flexDirection: 'row', gap: 6, flex: 1 },
  pill: {
    flex: 1, paddingVertical: 7, borderRadius: 99,
    backgroundColor: '#f3f4f6', alignItems: 'center',
  },
  pillActive: { backgroundColor: '#4f46e5' },
  pillText: { fontSize: 12, fontWeight: '600', color: '#6b7280' },
  pillTextActive: { color: 'white' },
})
