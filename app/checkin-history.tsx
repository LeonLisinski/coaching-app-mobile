import { supabase } from '@/lib/supabase'
import { useLanguage } from '@/lib/LanguageContext'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator, Dimensions, Modal, Platform,
  ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native'

type Parameter = {
  id: string
  name: string
  type: string
  unit: string | null
  order_index: number
}

type PhotoEntry = { position: string; url: string }

type CheckinEntry = {
  id: string
  date: string
  values: Record<string, any>
  photo_urls: PhotoEntry[] | null
  trainer_comment: string | null
}

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window')

function getWeekNumber(dateStr: string): number {
  const date = new Date(dateStr)
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('hr', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
}

// ── Photo Lightbox ────────────────────────────────────────────────────────────
function PhotoLightbox({
  photos, initialIndex, checkinDate, onClose,
}: {
  photos: PhotoEntry[]
  initialIndex: number
  checkinDate: string
  onClose: () => void
}) {
  const [index, setIndex] = useState(initialIndex)
  const photo = photos[index]

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <StatusBar hidden />
      <View style={lbStyles.backdrop}>

        {/* Top bar */}
        <View style={lbStyles.topBar}>
          <View style={lbStyles.positionBadge}>
            <Text style={lbStyles.positionText}>{photo.position.toUpperCase()}</Text>
          </View>
          <TouchableOpacity
            onPress={onClose}
            style={lbStyles.closeBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={lbStyles.closeText}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Image */}
        <View style={lbStyles.imageContainer}>
          <Image
            source={{ uri: photo.url }}
            style={lbStyles.image}
            contentFit="contain"
            transition={200}
          />
        </View>

        {/* Date label */}
        <Text style={lbStyles.dateLabel}>{formatDate(checkinDate)}</Text>

        {/* Navigation */}
        {photos.length > 1 && (
          <View style={lbStyles.navRow}>
            <TouchableOpacity
              onPress={() => setIndex(i => Math.max(0, i - 1))}
              style={[lbStyles.navBtn, index === 0 && lbStyles.navBtnDisabled]}
              disabled={index === 0}
            >
              <Text style={lbStyles.navBtnText}>‹</Text>
            </TouchableOpacity>

            <View style={lbStyles.dots}>
              {photos.map((_, i) => (
                <TouchableOpacity key={i} onPress={() => setIndex(i)}>
                  <View style={[lbStyles.dot, i === index && lbStyles.dotActive]} />
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              onPress={() => setIndex(i => Math.min(photos.length - 1, i + 1))}
              style={[lbStyles.navBtn, index === photos.length - 1 && lbStyles.navBtnDisabled]}
              disabled={index === photos.length - 1}
            >
              <Text style={lbStyles.navBtnText}>›</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  )
}

const lbStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  topBar: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 58 : 36,
    left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, zIndex: 10,
  },
  positionBadge: {
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 99,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  positionText: { color: 'white', fontSize: 12, fontWeight: '700', letterSpacing: 1.2 },
  closeBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  closeText: { color: 'white', fontSize: 20, lineHeight: 22 },
  imageContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  image: { width: SCREEN_W, height: SCREEN_H * 0.72 },
  dateLabel: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 118 : 98,
    alignSelf: 'center',
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13, fontWeight: '500',
  },
  navRow: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 60 : 44,
    left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 24,
  },
  navBtn: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center', justifyContent: 'center',
  },
  navBtnDisabled: { opacity: 0.25 },
  navBtnText: { color: 'white', fontSize: 32, fontWeight: '200', lineHeight: 38 },
  dots: { flexDirection: 'row', gap: 7, alignItems: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotActive: { backgroundColor: 'white', width: 9, height: 9, borderRadius: 5 },
})

// ── Check-in Card ─────────────────────────────────────────────────────────────
function CheckinCard({
  checkin, params, onPhotoPress, highlightComment = false, filterMode = 'all',
}: {
  checkin: CheckinEntry
  params: Parameter[]
  onPhotoPress: (photos: PhotoEntry[], index: number) => void
  highlightComment?: boolean
  filterMode?: FilterMode
}) {
  const { t } = useLanguage()
  const weekNum = getWeekNumber(checkin.date)
  const photos = (checkin.photo_urls ?? []).filter(p => p?.url)

  const numberParams = params.filter(
    p => p.type === 'number' && checkin.values?.[p.id] != null && checkin.values[p.id] !== '',
  )
  const otherParams = params.filter(
    p => p.type !== 'number' && checkin.values?.[p.id] != null && checkin.values[p.id] !== '',
  )

  const hasValues = numberParams.length > 0 || otherParams.length > 0

  return (
    <View style={cardStyles.card}>

      {/* Header row */}
      <View style={cardStyles.cardHeader}>
        <View>
          <Text style={cardStyles.dateText}>{formatDate(checkin.date)}</Text>
          <Text style={cardStyles.weekText}>Tjedan {weekNum}</Text>
        </View>
        <View style={cardStyles.badgeRow}>
          {checkin.trainer_comment ? (
            <View style={cardStyles.badgeComment}>
              <Text style={cardStyles.badgeCommentText}>K</Text>
            </View>
          ) : null}
          {photos.length > 0 && (
            <View style={cardStyles.badgePhoto}>
              <Text style={cardStyles.badgePhotoText}>{photos.length} {t('ch_photos')}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Numeric values */}
      {numberParams.length > 0 && (
        <View style={cardStyles.valuesRow}>
          {numberParams.map(param => (
            <View key={param.id} style={cardStyles.valueCell}>
              <Text style={cardStyles.valueBig} numberOfLines={1}>
                {checkin.values[param.id]}
                {param.unit ? <Text style={cardStyles.valueUnit}> {param.unit}</Text> : null}
              </Text>
              <Text style={cardStyles.valueLabel} numberOfLines={1}>{param.name}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Other params as chips */}
      {otherParams.length > 0 && (
        <View style={cardStyles.chipsWrap}>
          {otherParams.map(param => {
            const raw = checkin.values[param.id]
            let display = ''
            if (param.type === 'boolean') display = raw ? '✓  Da' : '✗  Ne'
            else display = String(raw)
            const isTrue = param.type === 'boolean' && raw
            const isFalse = param.type === 'boolean' && !raw
            return (
              <View
                key={param.id}
                style={[cardStyles.chip, isTrue && cardStyles.chipGreen, isFalse && cardStyles.chipRed]}
              >
                <Text
                  style={[
                    cardStyles.chipText,
                    isTrue && cardStyles.chipTextGreen,
                    isFalse && cardStyles.chipTextRed,
                  ]}
                >
                  {param.name}: {display}
                </Text>
              </View>
            )
          })}
        </View>
      )}

      {!hasValues && photos.length === 0 && !checkin.trainer_comment && (
        <Text style={cardStyles.emptyText}>Nema unesenih vrijednosti</Text>
      )}

      {/* Trainer comment — hidden in 'photos' tab */}
      {checkin.trainer_comment && filterMode !== 'photos' ? (
        <View style={[cardStyles.commentCard, highlightComment && cardStyles.commentCardHighlight]}>
          <View style={cardStyles.commentHeader}>
            <Text style={cardStyles.commentLabel}>{t('ch_trainer_comment')}</Text>
          </View>
          <Text style={cardStyles.commentText}>{checkin.trainer_comment}</Text>
        </View>
      ) : null}

      {/* Progress photos — hidden in 'comments' tab */}
      {photos.length > 0 && filterMode !== 'comments' && (
        <View style={cardStyles.photosSection}>
          <Text style={cardStyles.photosSectionLabel}>Fotografije napretka</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={cardStyles.photosScrollContent}
          >
            {photos.map((photo, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => onPhotoPress(photos, i)}
                activeOpacity={0.82}
                style={cardStyles.photoWrap}
              >
                <Image
                  source={{ uri: photo.url }}
                  style={cardStyles.photoThumb}
                  contentFit="cover"
                  transition={300}
                />
                <View style={cardStyles.photoLabelWrap}>
                  <Text style={cardStyles.photoLabel} numberOfLines={1}>
                    {photo.position}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  )
}

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: 'white',
    borderRadius: 20,
    marginHorizontal: 16,
    marginBottom: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 10,
    elevation: 3,
  },
  cardHeader: {
    backgroundColor: '#fef9f0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#fde68a',
  },
  dateText: { fontSize: 15, fontWeight: '700', color: '#78350f' },
  weekText: { fontSize: 12, color: '#a16207', marginTop: 2, fontWeight: '500' },
  badgeRow: { flexDirection: 'row', gap: 6 },
  badgeComment: {
    backgroundColor: '#eff6ff', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 4,
  },
  badgeCommentText: { fontSize: 12 },
  badgePhoto: {
    backgroundColor: '#78350f', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4,
  },
  badgePhotoText: { fontSize: 11, color: 'white', fontWeight: '600' },

  valuesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
    gap: 20,
  },
  valueCell: { alignItems: 'flex-start', minWidth: 72 },
  valueBig: { fontSize: 24, fontWeight: '800', color: '#111827', letterSpacing: -0.5 },
  valueUnit: { fontSize: 14, fontWeight: '500', color: '#9ca3af' },
  valueLabel: {
    fontSize: 11, color: '#9ca3af', fontWeight: '600',
    marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.5,
  },

  chipsWrap: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4,
  },
  chip: {
    backgroundColor: '#f3f4f6', borderRadius: 99,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  chipGreen: { backgroundColor: '#dcfce7' },
  chipRed: { backgroundColor: '#fee2e2' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#374151' },
  chipTextGreen: { color: '#15803d' },
  chipTextRed: { color: '#dc2626' },

  emptyText: { fontSize: 13, color: '#d1d5db', padding: 16, fontStyle: 'italic' },

  commentCard: {
    backgroundColor: '#eff6ff',
    borderRadius: 14,
    margin: 12,
    marginTop: 12,
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: '#3b82f6',
  },
  commentHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  commentIcon: { fontSize: 14 },
  commentLabel: {
    fontSize: 11, fontWeight: '700', color: '#1d4ed8',
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  commentText: { fontSize: 13, color: '#1e40af', lineHeight: 20 },
  commentCardHighlight: {
    backgroundColor: '#eff6ff',
    borderLeftColor: '#1d4ed8',
    borderLeftWidth: 4,
    marginTop: 14,
    borderRadius: 14,
  },

  photosSection: { paddingTop: 4, paddingBottom: 16 },
  photosSectionLabel: {
    fontSize: 10, fontWeight: '700', color: '#9ca3af',
    letterSpacing: 1, textTransform: 'uppercase',
    paddingHorizontal: 16, marginBottom: 10,
  },
  photosScrollContent: { paddingHorizontal: 16, gap: 10 },
  photoWrap: { alignItems: 'center' },
  photoThumb: {
    width: 96, height: 122,
    borderRadius: 12, backgroundColor: '#f3f4f6',
  },
  photoLabelWrap: {
    marginTop: 5, backgroundColor: '#f3f4f6',
    borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3,
  },
  photoLabel: { fontSize: 10, color: '#6b7280', fontWeight: '600', textTransform: 'capitalize' },
})

type FilterMode = 'all' | 'comments' | 'photos'

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function CheckinHistoryScreen() {
  const { t } = useLanguage()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [checkins, setCheckins] = useState<CheckinEntry[]>([])
  const [params, setParams] = useState<Parameter[]>([])
  const [lightbox, setLightbox] = useState<{
    photos: PhotoEntry[]
    index: number
    date: string
  } | null>(null)
  const [filter, setFilter] = useState<FilterMode>('all')
  const [compareMode, setCompareMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  useEffect(() => { fetchData() }, [])

  // Must be before any early returns (Rules of Hooks)
  const filtered = useMemo(() => {
    if (filter === 'comments') return checkins.filter(c => !!c.trainer_comment)
    if (filter === 'photos')   return checkins.filter(c => Array.isArray(c.photo_urls) && c.photo_urls.some(p => !!p?.url))
    return checkins
  }, [filter, checkins])

  const fetchData = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: client } = await supabase
      .from('clients').select('id, trainer_id')
      .eq('user_id', user.id).single()
    if (!client) { setLoading(false); return }

    const [{ data: checkinData }, { data: paramData }] = await Promise.all([
      supabase.from('checkins')
        .select('id, date, values, photo_urls, trainer_comment')
        .eq('client_id', client.id)
        .order('date', { ascending: false }),
      supabase.from('checkin_parameters')
        .select('id, name, type, unit, order_index')
        .eq('trainer_id', client.trainer_id)
        .order('order_index'),
    ])

    if (checkinData) setCheckins(checkinData)
    if (paramData) setParams(paramData)
    setLoading(false)
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < 5) next.add(id)
      return next
    })
  }

  const startCompare = () => {
    const ids = Array.from(selectedIds).join(',')
    router.push(`/compare-photos?ids=${ids}`)
    setCompareMode(false)
    setSelectedIds(new Set())
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#f59e0b" />
      </View>
    )
  }

  const totalPhotos = checkins.reduce(
    (sum, c) => sum + (Array.isArray(c.photo_urls) ? c.photo_urls.filter(p => p?.url).length : 0), 0,
  )
  const withComments = checkins.filter(c => !!c.trainer_comment).length
  const withPhotos   = checkins.filter(c => Array.isArray(c.photo_urls) && c.photo_urls.some(p => !!p?.url))

  return (
    <View style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <View style={styles.backBtnInner}>
              <Text style={styles.backArrow}>‹</Text>
              <Text style={styles.backText}>{t('tab_checkin')}</Text>
            </View>
          </TouchableOpacity>

          {/* Compare toggle button */}
          {withPhotos.length >= 2 && (
            <TouchableOpacity
              onPress={() => { setCompareMode(c => !c); setSelectedIds(new Set()) }}
              style={[styles.compareToggleBtn, compareMode && styles.compareToggleBtnActive]}
              activeOpacity={0.8}
            >
              <Text style={[styles.compareToggleText, compareMode && { color: '#78350f' }]}>
                {compareMode ? '✕ Odustani' : '⊞ Usporedi'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.headerTitle}>{t('ch_title')}</Text>

        {checkins.length > 0 && (
          <View style={styles.statsRow}>
            <View style={styles.statCell}>
              <Text style={styles.statNum}>{checkins.length}</Text>
              <Text style={styles.statLabel}>check-inova</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCell}>
              <Text style={styles.statNum}>{totalPhotos}</Text>
              <Text style={styles.statLabel}>fotografija</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCell}>
              <Text style={styles.statNum}>{withComments}</Text>
              <Text style={styles.statLabel}>komentara</Text>
            </View>
          </View>
        )}
      </View>

      {/* Empty state */}
      {checkins.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyEmoji}>📋</Text>
          <Text style={styles.emptyTitle}>{t('ch_empty_title')}</Text>
          <Text style={styles.emptySub}>{t('ch_empty_sub')}</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.emptyBtn}>
            <Text style={styles.emptyBtnText}>{t('tab_checkin')} →</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {/* Filter tabs */}
          {!compareMode && (
            <View style={styles.filterBar}>
              {([
                { key: 'all',      label: `${t('ch_filter_all')} (${checkins.length})` },
                { key: 'comments', label: `${t('ch_filter_comments')} (${withComments})` },
                { key: 'photos',   label: `${t('ch_filter_photos')} (${withPhotos.length})` },
              ] as { key: FilterMode; label: string }[]).map(f => (
                <TouchableOpacity
                  key={f.key}
                  style={[styles.filterTab, filter === f.key && styles.filterTabActive]}
                  onPress={() => setFilter(f.key)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.filterTabText, filter === f.key && styles.filterTabTextActive]}>
                    {f.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {compareMode && (
            <View style={styles.compareBar}>
              <Text style={styles.compareBarText}>
                Odaberi 2–5 check-inova za usporedbu fotografija
              </Text>
            </View>
          )}

          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            <Text style={styles.sectionLabel}>
              {compareMode
                ? `ODABRANO  ·  ${selectedIds.size} / 5`
                : `POVIJEST  ·  ${filtered.length} ${filtered.length === 1 ? 'unos' : 'unosa'}`
              }
            </Text>

            {filtered.length === 0 ? (
              <View style={styles.filterEmpty}>
                <Text style={styles.filterEmptyText}>
                  {filter === 'comments' ? `${t('ch_empty_title')} (${t('ch_filter_comments')})` : `${t('ch_empty_title')} (${t('ch_filter_photos')})`}
                </Text>
              </View>
            ) : (
              filtered.map(checkin => {
                const hasPhotos = (checkin.photo_urls?.filter(p => p?.url).length ?? 0) > 0
                const isSelected = selectedIds.has(checkin.id)
                const canSelect = !compareMode || hasPhotos

                return (
                  <TouchableOpacity
                    key={checkin.id}
                    onPress={compareMode && canSelect ? () => toggleSelect(checkin.id) : undefined}
                    activeOpacity={compareMode ? 0.8 : 1}
                    style={compareMode && !canSelect ? { opacity: 0.4 } : undefined}
                  >
                    {compareMode && (
                      <View style={styles.selectOverlay}>
                        <View style={[styles.selectCircle, isSelected && styles.selectCircleActive]}>
                          {isSelected && <Text style={styles.selectCheck}>✓</Text>}
                        </View>
                      </View>
                    )}
                    <CheckinCard
                      checkin={checkin}
                      params={params}
                      onPhotoPress={compareMode ? () => {} : (photos, index) =>
                        setLightbox({ photos, index, date: checkin.date })
                      }
                      highlightComment={filter === 'comments'}
                      filterMode={filter}
                    />
                  </TouchableOpacity>
                )
              })
            )}
            <View style={{ height: compareMode ? 100 : 40 }} />
          </ScrollView>

          {/* Compare action button */}
          {compareMode && selectedIds.size >= 2 && (
            <View style={styles.compareActionWrap}>
              <TouchableOpacity style={styles.compareActionBtn} onPress={startCompare} activeOpacity={0.85}>
                <Text style={styles.compareActionText}>
                  ⊞  Usporedi {selectedIds.size} termina
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}

      {/* Photo lightbox */}
      {lightbox && (
        <PhotoLightbox
          photos={lightbox.photos}
          initialIndex={lightbox.index}
          checkinDate={lightbox.date}
          onClose={() => setLightbox(null)}
        />
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
    backgroundColor: '#78350f',
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
    backgroundColor: '#78350f', borderRadius: 14, paddingHorizontal: 24, paddingVertical: 13,
  },
  emptyBtnText: { color: 'white', fontSize: 15, fontWeight: '700' },

  list: { paddingTop: 22, paddingBottom: 32 },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: '#9ca3af',
    letterSpacing: 1, textTransform: 'uppercase',
    paddingHorizontal: 20, marginBottom: 14,
  },

  headerTopRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 14,
  },
  compareToggleBtn: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 99, paddingHorizontal: 14, paddingVertical: 8,
  },
  compareToggleBtnActive: { backgroundColor: 'white' },
  compareToggleText: { fontSize: 13, color: 'white', fontWeight: '700' },

  filterBar: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  filterTab: {
    flex: 1, alignItems: 'center', paddingVertical: 8,
    borderRadius: 10, backgroundColor: '#f3f4f6',
  },
  filterTabActive: { backgroundColor: '#78350f' },
  filterTabText: { fontSize: 11, fontWeight: '600', color: '#6b7280' },
  filterTabTextActive: { color: 'white' },
  filterEmpty: { alignItems: 'center', paddingTop: 48, paddingHorizontal: 32 },
  filterEmptyText: { fontSize: 14, color: '#9ca3af', textAlign: 'center' },

  compareBar: {
    backgroundColor: '#fef3c7', paddingHorizontal: 20, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#fde68a',
  },
  compareBarText: { fontSize: 13, color: '#92400e', fontWeight: '500', textAlign: 'center' },

  selectOverlay: {
    position: 'absolute', top: 14, left: 28, zIndex: 10,
  },
  selectCircle: {
    width: 26, height: 26, borderRadius: 13,
    borderWidth: 2, borderColor: '#d1d5db',
    backgroundColor: 'white', alignItems: 'center', justifyContent: 'center',
  },
  selectCircleActive: { backgroundColor: '#78350f', borderColor: '#78350f' },
  selectCheck: { color: 'white', fontWeight: '800', fontSize: 13 },

  compareActionWrap: {
    position: 'absolute', bottom: 24, left: 24, right: 24,
  },
  compareActionBtn: {
    backgroundColor: '#78350f', borderRadius: 16,
    paddingVertical: 16, alignItems: 'center',
    shadowColor: '#78350f', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 6,
  },
  compareActionText: { color: 'white', fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
})
