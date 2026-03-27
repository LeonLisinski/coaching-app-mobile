import { supabase } from '@/lib/supabase'
import { useLanguage } from '@/lib/LanguageContext'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator, Platform, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native'

type PackageInfo = {
  id: string
  name: string
  color: string
  price: number
  duration_days: number
}

type ClientPackage = {
  id: string
  package_id: string | null
  start_date: string
  end_date: string
  price: number
  status: string
  notes: string | null
  packages: PackageInfo | null
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('hr-HR', { day: 'numeric', month: 'long', year: 'numeric' })
}

function daysLeft(endDate: string): number {
  return Math.ceil((new Date(endDate + 'T00:00:00').getTime() - Date.now()) / 86400000)
}

function durationLabel(days: number): string {
  const m = Math.round(days / 30)
  if (m === 1) return '1 mjesec'
  if (m < 5) return `${m} mjeseca`
  return `${m} mjeseci`
}

function progressPercent(start: string, end: string): number {
  const s = new Date(start + 'T00:00:00').getTime()
  const e = new Date(end + 'T00:00:00').getTime()
  const now = Date.now()
  const total = e - s
  if (total <= 0) return 100
  const elapsed = now - s
  return Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)))
}

type PackageStatus = 'active' | 'expired' | 'cancelled' | 'pending'

function getStatusConfig(status: string, t: (k: any) => string): { label: string; color: string; bg: string } {
  switch (status) {
    case 'active':    return { label: t('pkg_active'),    color: '#15803d', bg: '#dcfce7' }
    case 'expired':   return { label: t('pkg_expired'),   color: '#6b7280', bg: '#f3f4f6' }
    case 'cancelled': return { label: t('pkg_cancelled'), color: '#991b1b', bg: '#fee2e2' }
    default:          return { label: t('pkg_pending'),   color: '#92400e', bg: '#fef3c7' }
  }
}

export default function PackageScreen() {
  const { t } = useLanguage()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [activePackage, setActivePackage] = useState<ClientPackage | null>(null)
  const [history, setHistory] = useState<ClientPackage[]>([])

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: client } = await supabase
      .from('clients').select('id, trainer_id')
      .eq('user_id', user.id).single()
    if (!client) { setLoading(false); return }

    // Step 1: get basic client_packages rows (no join — avoids RLS issues on packages table)
    const { data: rawCp, error: rawErr } = await supabase
      .from('client_packages')
      .select('id, start_date, end_date, price, status, notes, package_id')
      .eq('client_id', client.id)
      .order('start_date', { ascending: false })

    if (rawErr) {
      console.warn('client_packages error:', rawErr.message)
      setLoading(false)
      return
    }

    if (!rawCp || rawCp.length === 0) {
      setLoading(false)
      return
    }

    // Step 2: fetch package details separately for each unique package_id
    const packageIds = [...new Set(rawCp.map(r => r.package_id).filter(Boolean))]
    let packageMap: Record<string, PackageInfo> = {}
    if (packageIds.length > 0) {
      const { data: pkgData } = await supabase
        .from('packages')
        .select('id, name, color, price, duration_days')
        .in('id', packageIds)
      pkgData?.forEach(p => { packageMap[p.id] = p })
    }

    // Combine
    const combined: ClientPackage[] = rawCp.map(cp => ({
      ...cp,
      packages: cp.package_id ? (packageMap[cp.package_id] ?? null) : null,
    }))

    const isActive = (s: string) => s?.toLowerCase() === 'active'
    const active = combined.find(cp => isActive(cp.status)) ?? null
    const past   = combined.filter(cp => !isActive(cp.status))
    setActivePackage(active)
    setHistory(past)
    setLoading(false)
  }

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#7c3aed" />
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
            <Text style={styles.backText}>Natrag</Text>
          </View>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Moj paket</Text>
        <Text style={styles.headerSub}>Pregled aktivnog paketa i pretplate</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Active package */}
        {!activePackage ? (
          <View style={styles.noPackage}>
          <Text style={styles.noPackageEmoji}>📦</Text>
          <Text style={styles.noPackageTitle}>{t('pkg_empty_title')}</Text>
          <Text style={styles.noPackageSub}>{t('pkg_empty_sub')}</Text>
        </View>
        ) : (
          <ActivePackageCard cp={activePackage} />
        )}

        {/* History */}
        {history.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('pkg_history').toUpperCase()}</Text>
            {history.map(cp => (
              <HistoryCard key={cp.id} cp={cp} />
            ))}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  )
}

function ActivePackageCard({ cp }: { cp: ClientPackage }) {
  const { t } = useLanguage()
  const pkg = cp.packages
  const pkgColor = pkg?.color ?? '#7c3aed'
  const left = daysLeft(cp.end_date)
  const progress = progressPercent(cp.start_date, cp.end_date)
  const statusConf = getStatusConfig(cp.status, t)

  return (
    <View style={[activeStyles.card, { borderTopColor: pkgColor, borderTopWidth: 4 }]}>
      <View style={activeStyles.topRow}>
        <View style={[activeStyles.colorDot, { backgroundColor: pkgColor }]} />
        <View style={{ flex: 1 }}>
          <Text style={activeStyles.name}>{pkg?.name ?? 'Aktivni paket'}</Text>
          <Text style={activeStyles.activeBadge}>● AKTIVNO</Text>
        </View>
        <View style={[activeStyles.payBadge, { backgroundColor: statusConf.bg }]}>
          <Text style={[activeStyles.payBadgeText, { color: statusConf.color }]}>
            {statusConf.label}
          </Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={activeStyles.progressSection}>
        <View style={activeStyles.progressLabelRow}>
          <Text style={activeStyles.progressLabel}>{t('pkg_progress')}</Text>
          <Text style={activeStyles.progressPct}>{progress}%</Text>
        </View>
        <View style={activeStyles.progressTrack}>
          <View style={[activeStyles.progressFill, { width: `${progress}%` as any, backgroundColor: pkgColor }]} />
        </View>
        <View style={activeStyles.progressDates}>
          <Text style={activeStyles.progressDate}>{fmtDate(cp.start_date)}</Text>
          <Text style={activeStyles.progressDate}>{fmtDate(cp.end_date)}</Text>
        </View>
      </View>

      {/* Days remaining */}
      <View style={activeStyles.daysRow}>
        <View style={[activeStyles.daysCard, left <= 7 && activeStyles.daysCardWarning]}>
          <Text style={[activeStyles.daysNum, left <= 7 && activeStyles.daysNumWarning]}>
            {left > 0 ? left : 0}
          </Text>
          <Text style={[activeStyles.daysLabel, left <= 7 && activeStyles.daysLabelWarning]}>
            {left > 0 ? `${t('pkg_days_left')}` : t('pkg_expired')}
          </Text>
        </View>
        <View style={activeStyles.daysCard}>
          <Text style={activeStyles.daysNum}>
            {pkg?.duration_days
              ? durationLabel(pkg.duration_days)
              : cp.start_date && cp.end_date
                ? durationLabel(Math.round((new Date(cp.end_date + 'T00:00:00').getTime() - new Date(cp.start_date + 'T00:00:00').getTime()) / 86400000))
                : 'Neograničeno'}
          </Text>
          <Text style={activeStyles.daysLabel}>{t('pkg_duration')}</Text>
        </View>
        <View style={activeStyles.daysCard}>
          <Text style={activeStyles.daysNum}>
            {cp.price ? `${cp.price} €` : '—'}
          </Text>
          <Text style={activeStyles.daysLabel}>jednokratno</Text>
        </View>
      </View>

      {cp.notes ? (
        <View style={activeStyles.notes}>
          <Text style={activeStyles.notesText}>{cp.notes}</Text>
        </View>
      ) : null}
    </View>
  )
}

const activeStyles = StyleSheet.create({
  card: {
    backgroundColor: 'white', borderRadius: 20, marginHorizontal: 16, marginTop: 20,
    padding: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08, shadowRadius: 12, elevation: 3,
  },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 20 },
  colorDot: { width: 14, height: 14, borderRadius: 7, marginTop: 4 },
  name: { fontSize: 18, fontWeight: '800', color: '#111827', marginBottom: 2 },
  activeBadge: { fontSize: 11, color: '#15803d', fontWeight: '700', letterSpacing: 0.5 },
  payBadge: { borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start' },
  payBadgeText: { fontSize: 11, fontWeight: '700' },

  progressSection: { marginBottom: 20 },
  progressLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  progressLabel: { fontSize: 12, color: '#6b7280', fontWeight: '600' },
  progressPct: { fontSize: 12, fontWeight: '700', color: '#374151' },
  progressTrack: {
    height: 8, backgroundColor: '#f3f4f6', borderRadius: 99, overflow: 'hidden',
  },
  progressFill: { height: 8, borderRadius: 99 },
  progressDates: {
    flexDirection: 'row', justifyContent: 'space-between', marginTop: 6,
  },
  progressDate: { fontSize: 11, color: '#9ca3af' },

  daysRow: { flexDirection: 'row', gap: 10, marginBottom: 4 },
  daysCard: {
    flex: 1, backgroundColor: '#f9fafb', borderRadius: 14,
    padding: 12, alignItems: 'center',
  },
  daysCardWarning: { backgroundColor: '#fef3c7' },
  daysNum: { fontSize: 16, fontWeight: '800', color: '#111827', marginBottom: 2, textAlign: 'center' },
  daysNumWarning: { color: '#92400e' },
  daysLabel: { fontSize: 11, color: '#9ca3af', textAlign: 'center', fontWeight: '500' },
  daysLabelWarning: { color: '#92400e' },

  notes: {
    marginTop: 16, backgroundColor: '#f9fafb', borderRadius: 12, padding: 14,
    borderLeftWidth: 3, borderLeftColor: '#d1d5db',
  },
  notesText: { fontSize: 13, color: '#6b7280', lineHeight: 20 },
})

function HistoryCard({ cp }: { cp: ClientPackage }) {
  const { t } = useLanguage()
  const pkg = cp.packages
  const pkgColor = pkg?.color ?? '#9ca3af'
  const statusConf = getStatusConfig(cp.status, t)

  return (
    <View style={histStyles.card}>
      <View style={[histStyles.colorBar, { backgroundColor: pkgColor }]} />
      <View style={histStyles.body}>
        <View style={histStyles.topRow}>
          <Text style={histStyles.name}>{pkg?.name ?? 'Paket'}</Text>
          <View style={[histStyles.statusBadge, { backgroundColor: statusConf.bg }]}>
            <Text style={[histStyles.statusText, { color: statusConf.color }]}>{statusConf.label}</Text>
          </View>
        </View>
        <Text style={histStyles.dates}>
          {fmtDate(cp.start_date)} – {fmtDate(cp.end_date)}
        </Text>
        {cp.price > 0 && (
          <Text style={histStyles.price}>{cp.price} €</Text>
        )}
      </View>
    </View>
  )
}

const histStyles = StyleSheet.create({
  card: {
    flexDirection: 'row', backgroundColor: 'white', borderRadius: 16,
    marginBottom: 10, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
  },
  colorBar: { width: 5 },
  body: { flex: 1, padding: 14 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  name: { fontSize: 15, fontWeight: '700', color: '#374151', flex: 1, marginRight: 8 },
  statusBadge: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 4 },
  statusText: { fontSize: 11, fontWeight: '700' },
  dates: { fontSize: 12, color: '#9ca3af', marginBottom: 2 },
  price: { fontSize: 13, fontWeight: '600', color: '#6b7280' },
})

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f3f4f6' },

  header: {
    backgroundColor: '#7c3aed',
    paddingTop: Platform.OS === 'ios' ? 60 : 44,
    paddingHorizontal: 20,
    paddingBottom: 28,
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
  headerTitle: { fontSize: 28, fontWeight: '800', color: 'white', marginBottom: 4 },
  headerSub: { fontSize: 14, color: 'rgba(255,255,255,0.65)' },

  noPackage: {
    margin: 20, backgroundColor: 'white', borderRadius: 20, padding: 32,
    alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 10, elevation: 2,
  },
  noPackageEmoji: { fontSize: 28, marginBottom: 12 },
  noPackageTitle: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 8 },
  noPackageSub: { fontSize: 14, color: '#9ca3af', textAlign: 'center', lineHeight: 22 },

  content: { paddingBottom: 32 },
  section: { marginTop: 28, paddingHorizontal: 16 },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: '#9ca3af',
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12,
  },
})
