import { supabase } from '@/lib/supabase'
import { useLanguage } from '@/lib/LanguageContext'
import { Image } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator, Dimensions, Platform, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native'

type PhotoEntry = { position: string; url: string }
type CheckinData = {
  id: string
  date: string
  photo_urls: PhotoEntry[] | null
}

const { width: SCREEN_W } = Dimensions.get('window')

const POSITION_LABELS: Record<string, string> = {
  front: 'Prednja',
  side: 'Bočna',
  back: 'Stražnja',
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('hr-HR', { day: 'numeric', month: 'short' })
}

export default function ComparePhotosScreen() {
  const { t } = useLanguage()
  const router = useRouter()
  const { ids } = useLocalSearchParams<{ ids: string }>()
  const [loading, setLoading] = useState(true)
  const [checkins, setCheckins] = useState<CheckinData[]>([])
  const [activePosition, setActivePosition] = useState<string>('')

  useEffect(() => {
    const idList = ids?.split(',').filter(Boolean) ?? []
    if (idList.length < 2) { setLoading(false); return }
    fetchCheckins(idList)
  }, [ids])

  const fetchCheckins = async (idList: string[]) => {
    const { data } = await supabase
      .from('checkins')
      .select('id, date, photo_urls')
      .in('id', idList)
      .order('date', { ascending: true })

    if (data) {
      setCheckins(data)
      // Determine default position: first position found across all selected check-ins
      const allPositions = new Set<string>()
      for (const c of data) {
        for (const p of (c.photo_urls ?? []).filter(p => p?.url)) {
          allPositions.add(p.position)
        }
      }
      const ordered = ['front', 'side', 'back']
      const first = ordered.find(pos => allPositions.has(pos)) ?? Array.from(allPositions)[0] ?? ''
      setActivePosition(first)
    }
    setLoading(false)
  }

  // All positions that appear in at least one selected check-in
  const availablePositions = Array.from(
    new Set(
      checkins.flatMap(c => (c.photo_urls ?? []).filter(p => p?.url).map(p => p.position)),
    ),
  ).sort((a, b) => {
    const order = ['front', 'side', 'back']
    return (order.indexOf(a) ?? 99) - (order.indexOf(b) ?? 99)
  })

  const PHOTO_W = Math.floor((SCREEN_W - 40) / Math.min(checkins.length, 3))
  const PHOTO_H = Math.round(PHOTO_W * 1.33)

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#78350f" />
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
            <Text style={styles.backText}>{t('back')}</Text>
          </View>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('cmp_title')}</Text>
        <Text style={styles.headerSub}>
          {checkins.length} termina · {checkins[0] ? formatDate(checkins[0].date) : ''} – {checkins[checkins.length - 1] ? formatDate(checkins[checkins.length - 1].date) : ''}
        </Text>
      </View>

      {availablePositions.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>📸</Text>
          <Text style={styles.emptyTitle}>{t('cmp_empty_title')}</Text>
          <Text style={styles.emptySub}>{t('cmp_empty_sub')}</Text>
        </View>
      ) : (
        <>
          {/* Position tabs */}
          {availablePositions.length > 1 && (
            <View style={styles.tabs}>
              {availablePositions.map(pos => (
                <TouchableOpacity
                  key={pos}
                  style={[styles.tab, activePosition === pos && styles.tabActive]}
                  onPress={() => setActivePosition(pos)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.tabText, activePosition === pos && styles.tabTextActive]}>
                    {POSITION_LABELS[pos] ?? pos}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Photos grid */}
          <ScrollView
            contentContainerStyle={styles.grid}
            showsVerticalScrollIndicator={false}
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.row}
            >
              {checkins.map(c => {
                const photo = (c.photo_urls ?? []).find(p => p?.url && p.position === activePosition)
                return (
                  <View key={c.id} style={[styles.column, { width: PHOTO_W + 8 }]}>
                    <Text style={styles.dateLabel}>{formatDate(c.date)}</Text>
                    {photo ? (
                      <Image
                        source={{ uri: photo.url }}
                        style={[styles.photo, { width: PHOTO_W, height: PHOTO_H }]}
                        contentFit="cover"
                        transition={400}
                      />
                    ) : (
                      <View style={[styles.photoEmpty, { width: PHOTO_W, height: PHOTO_H }]}>
                        <Text style={styles.photoEmptyIcon}>—</Text>
                        <Text style={styles.photoEmptyText}>Nema fotke</Text>
                      </View>
                    )}
                  </View>
                )
              })}
            </ScrollView>

            {/* Timeline below */}
            <View style={styles.timeline}>
              <Text style={styles.timelineLabel}>Kronološki pregled · {activePosition ? (POSITION_LABELS[activePosition] ?? activePosition) : ''}</Text>
              {checkins.map((c, i) => {
                const photo = (c.photo_urls ?? []).find(p => p?.url && p.position === activePosition)
                return (
                  <View key={c.id} style={styles.timelineRow}>
                    <View style={styles.timelineLeft}>
                      <View style={styles.timelineDot} />
                      {i < checkins.length - 1 && <View style={styles.timelineLine} />}
                    </View>
                    <View style={styles.timelineContent}>
                      <Text style={styles.timelineDate}>{formatDate(c.date)}</Text>
                      {photo ? (
                        <Image
                          source={{ uri: photo.url }}
                          style={styles.timelineThumb}
                          contentFit="cover"
                          transition={300}
                        />
                      ) : (
                        <View style={styles.timelineThumbEmpty}>
                          <Text style={styles.timelineThumbEmptyText}>Nema fotografije za ovaj termin</Text>
                        </View>
                      )}
                    </View>
                  </View>
                )
              })}
            </View>
            <View style={{ height: 40 }} />
          </ScrollView>
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f3f4f6' },

  header: {
    backgroundColor: '#78350f',
    paddingTop: Platform.OS === 'ios' ? 60 : 44,
    paddingHorizontal: 20,
    paddingBottom: 24,
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
  headerTitle: { fontSize: 26, fontWeight: '800', color: 'white', marginBottom: 4 },
  headerSub: { fontSize: 13, color: 'rgba(255,255,255,0.65)', fontWeight: '500' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyEmoji: { fontSize: 28, marginBottom: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 8 },
  emptySub: { fontSize: 14, color: '#9ca3af', textAlign: 'center', lineHeight: 22 },

  tabs: {
    flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: 'white', gap: 8,
    borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  tab: {
    flex: 1, alignItems: 'center', paddingVertical: 9,
    borderRadius: 10, backgroundColor: '#f3f4f6',
  },
  tabActive: { backgroundColor: '#78350f' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  tabTextActive: { color: 'white' },

  grid: { paddingTop: 20, paddingHorizontal: 16 },
  row: { paddingBottom: 4, gap: 8 },
  column: { alignItems: 'center' },
  dateLabel: {
    fontSize: 12, fontWeight: '700', color: '#374151',
    marginBottom: 8, textAlign: 'center',
  },
  photo: { borderRadius: 14 },
  photoEmpty: {
    borderRadius: 14, backgroundColor: '#e5e7eb',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#d1d5db', borderStyle: 'dashed',
  },
  photoEmptyIcon: { fontSize: 28, color: '#9ca3af', marginBottom: 4 },
  photoEmptyText: { fontSize: 11, color: '#9ca3af', fontWeight: '500' },

  timeline: { marginTop: 28, paddingBottom: 8 },
  timelineLabel: {
    fontSize: 11, fontWeight: '700', color: '#9ca3af',
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 20, paddingHorizontal: 4,
  },
  timelineRow: { flexDirection: 'row', marginBottom: 20 },
  timelineLeft: { width: 24, alignItems: 'center' },
  timelineDot: {
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: '#78350f', marginTop: 4,
  },
  timelineLine: {
    flex: 1, width: 2, backgroundColor: '#e5e7eb',
    marginTop: 4, marginBottom: -8,
  },
  timelineContent: { flex: 1, marginLeft: 12 },
  timelineDate: {
    fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 10,
  },
  timelineThumb: {
    width: '100%', height: 200, borderRadius: 14,
  },
  timelineThumbEmpty: {
    width: '100%', height: 80, borderRadius: 14,
    backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#e5e7eb', borderStyle: 'dashed',
  },
  timelineThumbEmptyText: { fontSize: 13, color: '#9ca3af' },
})
