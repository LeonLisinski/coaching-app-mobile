import { supabase } from '@/lib/supabase'
import { useLanguage } from '@/lib/LanguageContext'
import { useClient } from '@/lib/ClientContext'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator, Platform, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native'

type NutritionLog = {
  date: string
  confirmed: boolean
  calories: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
}

// DAY_NAMES are now derived from i18n inside components

const MONTH_ABBR_HR = ['sij','velj','ožu','tra','svi','lip','srp','kol','ruj','lis','stu','pro']
const MONTH_ABBR_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function getWeekBounds(offset: number): { start: string; end: string } {
  const now = new Date()
  const day = now.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + diffToMonday + offset * 7)
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const fmtISO = (d: Date) => d.toISOString().split('T')[0]
  return { start: fmtISO(monday), end: fmtISO(sunday) }
}

function fmtWeekLabel(start: string, end: string, lang: string): string {
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end + 'T00:00:00')
  const abbr = lang === 'hr' ? MONTH_ABBR_HR : MONTH_ABBR_EN
  return `${s.getDate()}. ${abbr[s.getMonth()]} – ${e.getDate()}. ${abbr[e.getMonth()]}`
}

function fmt(d: Date) { return d.toISOString().split('T')[0] }

function getWeekDays(start: string): string[] {
  const days: string[] = []
  const base = new Date(start)
  for (let i = 0; i < 7; i++) {
    const d = new Date(base)
    d.setDate(base.getDate() + i)
    days.push(d.toISOString().split('T')[0])
  }
  return days
}

function fmtShort(dateStr: string, dayNames: string[]): string {
  const d = new Date(dateStr + 'T00:00:00')
  return `${dayNames[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`
}

function isToday(dateStr: string): boolean {
  return dateStr === new Date().toISOString().split('T')[0]
}

function roundMacro(v: number | null): string {
  if (v == null) return '—'
  return v % 1 === 0 ? String(v) : v.toFixed(0)
}

// ── Row ───────────────────────────────────────────────────────────────────────
function DayRow({ date, log, isToday: today, dayNames }: {
  date: string
  log: NutritionLog | undefined
  isToday: boolean
  dayNames: string[]
}) {
  const isFuture = date > new Date().toISOString().split('T')[0]
  const hasData = !!log

  return (
    <View style={[
      rowStyles.row,
      today && rowStyles.rowToday,
      hasData && log.confirmed && rowStyles.rowConfirmed,
      isFuture && rowStyles.rowFuture,
    ]}>
      {/* Day name */}
      <View style={rowStyles.dayCell}>
        <Text style={[rowStyles.dayName, today && rowStyles.dayNameToday, isFuture && rowStyles.textFaded]}>
          {fmtShort(date, dayNames)}
        </Text>
        {today && <View style={rowStyles.todayDot} />}
      </View>

      {/* Macros */}
      <Text style={[rowStyles.macro, rowStyles.calCell, !hasData && rowStyles.textFaded]}>
        {hasData ? roundMacro(log.calories) : '—'}
      </Text>
      <Text style={[rowStyles.macro, !hasData && rowStyles.textFaded]}>
        {hasData ? roundMacro(log.protein) : '—'}
      </Text>
      <Text style={[rowStyles.macro, !hasData && rowStyles.textFaded]}>
        {hasData ? roundMacro(log.carbs) : '—'}
      </Text>
      <Text style={[rowStyles.macro, !hasData && rowStyles.textFaded]}>
        {hasData ? roundMacro(log.fat) : '—'}
      </Text>

      {/* Status */}
      <View style={rowStyles.statusCell}>
        {!hasData || isFuture
          ? <View style={rowStyles.dotEmpty} />
          : log.confirmed
            ? <View style={rowStyles.dotConfirmed}><Text style={rowStyles.dotText}>✓</Text></View>
            : <View style={rowStyles.dotPartial}><Text style={rowStyles.dotPartialText}>○</Text></View>
        }
      </View>
    </View>
  )
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 11, paddingHorizontal: 14,
    borderBottomWidth: 1, borderBottomColor: '#f9fafb',
  },
  rowToday: { backgroundColor: '#eff6ff' },
  rowConfirmed: { backgroundColor: '#f0fdf4' },
  rowFuture: { opacity: 0.45 },
  dayCell: { flex: 2.2, flexDirection: 'row', alignItems: 'center', gap: 6 },
  dayName: { fontSize: 13, fontWeight: '600', color: '#374151' },
  dayNameToday: { color: '#1d4ed8', fontWeight: '700' },
  todayDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#3b82f6' },
  macro: { flex: 1, fontSize: 13, color: '#374151', textAlign: 'center', fontWeight: '500' },
  calCell: { fontWeight: '700', color: '#111827' },
  textFaded: { color: '#d1d5db', fontWeight: '400' },
  statusCell: { width: 28, alignItems: 'center' },
  dotEmpty: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#e5e7eb' },
  dotConfirmed: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#22c55e', alignItems: 'center', justifyContent: 'center',
  },
  dotText: { fontSize: 10, color: 'white', fontWeight: '800' },
  dotPartial: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#fef9c3', borderWidth: 1, borderColor: '#fde047',
    alignItems: 'center', justifyContent: 'center',
  },
  dotPartialText: { fontSize: 13, color: '#a16207' },
})

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function NutritionHistoryScreen() {
  const { t, lang } = useLanguage()
  const router = useRouter()
  const { clientData: ctxClient } = useClient()
  const [loading, setLoading] = useState(true)
  const [weekOffset, setWeekOffset] = useState(0)
  const [logs, setLogs] = useState<NutritionLog[]>([])
  const [clientId, setClientId] = useState<string | null>(null)
  const [loadingWeek, setLoadingWeek] = useState(false)
  const DAY_NAMES = t('days_short').split(',')

  const week = getWeekBounds(weekOffset)
  const days = getWeekDays(week.start)
  const logMap: Record<string, NutritionLog> = {}
  for (const l of logs) logMap[l.date] = l

  useEffect(() => { initData() }, [])
  useEffect(() => {
    if (clientId) fetchWeek(clientId, week.start, week.end)
  }, [weekOffset, clientId])

  // Re-fetch current week on focus (catches confirms/edits made from main nutrition tab)
  useFocusEffect(
    useCallback(() => {
      if (clientId) fetchWeek(clientId, week.start, week.end)
    }, [clientId, weekOffset]),
  )

  const initData = async () => {
    const cId = ctxClient?.clientId
    if (!cId) { setLoading(false); return }
    setClientId(cId)
    await fetchWeek(cId, week.start, week.end)
    setLoading(false)
  }

  const fetchWeek = async (cId: string, start: string, end: string) => {
    setLoadingWeek(true)
    const { data } = await supabase
      .from('nutrition_logs')
      .select('date, confirmed, calories, protein, carbs, fat')
      .eq('client_id', cId)
      .gte('date', start)
      .lte('date', end)
    setLogs(data ?? [])
    setLoadingWeek(false)
  }

  // Compute weekly averages from days that have data
  const withData = logs.filter(l => l.calories != null)
  const avg = withData.length > 0 ? {
    calories: withData.reduce((s, l) => s + (l.calories ?? 0), 0) / withData.length,
    protein:  withData.reduce((s, l) => s + (l.protein ?? 0), 0) / withData.length,
    carbs:    withData.reduce((s, l) => s + (l.carbs ?? 0), 0) / withData.length,
    fat:      withData.reduce((s, l) => s + (l.fat ?? 0), 0) / withData.length,
  } : null

  const confirmedCount = logs.filter(l => l.confirmed).length

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#15803d" />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <View style={styles.backBtnInner}>
            <Text style={styles.backArrow}>‹</Text>
            <Text style={styles.backText}>{t('tab_nutrition')}</Text>
          </View>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('nh_title')}</Text>
        {confirmedCount > 0 && (
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>✓ {t('nh_confirmed_badge').replace('{n}', String(confirmedCount))}</Text>
          </View>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Week navigator */}
        <View style={styles.weekNav}>
          <TouchableOpacity
            style={styles.weekNavBtn}
            onPress={() => setWeekOffset(o => o - 1)}
            activeOpacity={0.7}
          >
            <Text style={styles.weekNavArrow}>‹</Text>
          </TouchableOpacity>

          <View style={styles.weekInfo}>
            <Text style={styles.weekLabel}>{fmtWeekLabel(week.start, week.end, lang)}</Text>
            {weekOffset < 0 && (
              <Text style={styles.weeksAgoText}>
                {Math.abs(weekOffset) === 1
                  ? t('nh_last_week')
                  : t('nh_weeks_ago').replace('{n}', String(Math.abs(weekOffset)))}
              </Text>
            )}
            {weekOffset === 0 && <Text style={[styles.weeksAgoText, { color: '#3b82f6' }]}>{t('nh_this_week')}</Text>}
          </View>

          <TouchableOpacity
            style={[styles.weekNavBtn, weekOffset >= 0 && styles.weekNavBtnDisabled]}
            onPress={() => weekOffset < 0 && setWeekOffset(o => o + 1)}
            disabled={weekOffset >= 0}
            activeOpacity={0.7}
          >
            <Text style={[styles.weekNavArrow, weekOffset >= 0 && styles.weekNavArrowFaded]}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Table */}
        <View style={styles.table}>
          {/* Table header */}
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, { flex: 2.2 }]}>{t('nh_day_header')}</Text>
            <Text style={[styles.tableHeaderCell, styles.calHeader]}>{t('nh_kcal_header')}</Text>
            <Text style={styles.tableHeaderCell}>P</Text>
            <Text style={styles.tableHeaderCell}>U</Text>
            <Text style={styles.tableHeaderCell}>M</Text>
            <View style={{ width: 28 }} />
          </View>

          {/* Loading overlay */}
          {loadingWeek ? (
            <View style={styles.tableLoading}>
              <ActivityIndicator color="#15803d" />
            </View>
          ) : (
            <>
              {days.map(date => (
                <DayRow
                  key={date}
                  date={date}
                  log={logMap[date]}
                  isToday={isToday(date)}
                  dayNames={DAY_NAMES}
                />
              ))}
            </>
          )}

          {/* Footer: weekly averages */}
          {avg && !loadingWeek && (
            <View style={styles.avgRow}>
              <View style={{ flex: 2.2 }}>
                <Text style={styles.avgLabel}>{t('met_avg')}</Text>
                <Text style={styles.avgSub}>{t('nh_days_count').replace('{n}', String(withData.length))}</Text>
              </View>
              <Text style={[styles.avgValue, styles.avgCalCell]}>{avg.calories.toFixed(0)}</Text>
              <Text style={styles.avgValue}>{avg.protein.toFixed(0)}</Text>
              <Text style={styles.avgValue}>{avg.carbs.toFixed(0)}</Text>
              <Text style={styles.avgValue}>{avg.fat.toFixed(0)}</Text>
              <View style={{ width: 28 }} />
            </View>
          )}

          {!loadingWeek && logs.length === 0 && (
            <View style={styles.noDataRow}>
              <Text style={styles.noDataText}>{t('nh_no_data')}</Text>
            </View>
          )}
        </View>

        {/* Legend */}
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#22c55e' }]} />
            <Text style={styles.legendText}>{t('nh_legend_confirmed')}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#fde047', borderWidth: 1, borderColor: '#ca8a04' }]} />
            <Text style={styles.legendText}>{t('nh_legend_unconfirmed')}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#eff6ff' }]} />
            <Text style={styles.legendText}>{t('nh_legend_today')}</Text>
          </View>
        </View>

        {/* Column legend */}
        <View style={styles.macroLegend}>
          <Text style={styles.macroLegendText}>{t('nh_macro_legend')}</Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f3f4f6' },

  header: {
    backgroundColor: '#14532d',
    paddingTop: Platform.OS === 'ios' ? 60 : 44,
    paddingHorizontal: 20,
    paddingBottom: 22,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  backBtn: { marginBottom: 12, alignSelf: 'flex-start' },
  backBtnInner: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 99, paddingHorizontal: 14, paddingVertical: 8,
  },
  backArrow: { fontSize: 22, color: 'white', lineHeight: 26, fontWeight: '300' },
  backText: { fontSize: 14, color: 'white', fontWeight: '600' },
  headerTitle: { fontSize: 26, fontWeight: '800', color: 'white', marginBottom: 8 },
  headerBadge: {
    backgroundColor: 'rgba(255,255,255,0.18)', alignSelf: 'flex-start',
    borderRadius: 99, paddingHorizontal: 12, paddingVertical: 5,
  },
  headerBadgeText: { fontSize: 12, color: 'white', fontWeight: '600' },

  content: { paddingTop: 20, paddingBottom: 32 },

  weekNav: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginBottom: 16,
    backgroundColor: 'white', borderRadius: 16, padding: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  weekNavBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center',
  },
  weekNavBtnDisabled: { opacity: 0.3 },
  weekNavArrow: { fontSize: 24, color: '#374151', fontWeight: '300' },
  weekNavArrowFaded: { color: '#d1d5db' },
  weekInfo: { flex: 1, alignItems: 'center' },
  weekLabel: { fontSize: 14, fontWeight: '700', color: '#111827' },
  weeksAgoText: { fontSize: 11, color: '#9ca3af', marginTop: 2, fontWeight: '500' },

  table: {
    backgroundColor: 'white', borderRadius: 20, marginHorizontal: 16,
    marginBottom: 14, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  tableHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 14,
    backgroundColor: '#f9fafb', borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  tableHeaderCell: { flex: 1, fontSize: 11, fontWeight: '700', color: '#9ca3af', textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.5 },
  calHeader: { color: '#374151' },
  tableLoading: { height: 220, alignItems: 'center', justifyContent: 'center' },

  avgRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 14,
    backgroundColor: '#f9fafb', borderTopWidth: 1, borderTopColor: '#f3f4f6',
  },
  avgLabel: { fontSize: 12, fontWeight: '700', color: '#374151' },
  avgSub: { fontSize: 10, color: '#9ca3af', marginTop: 1 },
  avgValue: { flex: 1, fontSize: 13, fontWeight: '700', color: '#111827', textAlign: 'center' },
  avgCalCell: { color: '#111827' },

  noDataRow: { paddingVertical: 32, alignItems: 'center' },
  noDataText: { fontSize: 14, color: '#9ca3af', fontStyle: 'italic' },

  legend: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 12,
    marginHorizontal: 16, marginTop: 6, marginBottom: 8,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
  legendText: { fontSize: 11, color: '#6b7280', fontWeight: '500' },
  macroLegend: { marginHorizontal: 16, marginBottom: 6 },
  macroLegendText: { fontSize: 11, color: '#9ca3af', textAlign: 'center' },
})
