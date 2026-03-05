import { supabase } from '@/lib/supabase'
import * as ImagePicker from 'expo-image-picker'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal,
  Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View
} from 'react-native'

type Parameter = {
  id: string; name: string; type: string; unit: string | null
  options: string[] | null; required: boolean; order_index: number; frequency: string
}
type CheckinConfig = { checkin_day: number | null; photo_frequency: string | null; photo_positions: string[] | null }
type CheckinValues = Record<string, any>
type ExistingCheckin = { id: string; values: CheckinValues; photo_urls: any[] | null; trainer_comment: string | null }
type DailyLog = { id: string; values: CheckinValues }

const DAYS = ['Nedjelja', 'Ponedjeljak', 'Utorak', 'Srijeda', 'Četvrtak', 'Petak', 'Subota']

const shouldSendPhotos = (frequency: string | null, lastCheckinDate: string | null): boolean => {
  if (!frequency) return false
  if (frequency === 'every' || frequency === 'weekly') return true
  if (frequency === 'biweekly') {
    if (!lastCheckinDate) return true
    return Math.floor((new Date().getTime() - new Date(lastCheckinDate).getTime()) / 86400000) >= 14
  }
  if (frequency === 'monthly') {
    if (!lastCheckinDate) return true
    const last = new Date(lastCheckinDate); const now = new Date()
    return last.getMonth() !== now.getMonth() || last.getFullYear() !== now.getFullYear()
  }
  return false
}

// ── Confirm modal ─────────────────────────────────────────────────────────────
function ConfirmCheckinModal({ onConfirm, onCancel, isUpdate }: { onConfirm: () => void; onCancel: () => void; isUpdate: boolean }) {
  return (
    <Modal visible animationType="fade" transparent onRequestClose={onCancel}>
      <View style={confirmStyles.overlay}>
        <View style={confirmStyles.card}>
          <Text style={confirmStyles.emoji}>{isUpdate ? '🔄' : '✅'}</Text>
          <Text style={confirmStyles.title}>{isUpdate ? 'Ažurirati check-in?' : 'Poslati check-in?'}</Text>
          <Text style={confirmStyles.sub}>
            {isUpdate
              ? 'Ažurirat ćeš postojeći check-in za ovaj tjedan.'
              : 'Check-in šalješ jednom tjedno. Trener će pregledati tvoj napredak.'}
          </Text>
          <View style={confirmStyles.btns}>
            <TouchableOpacity onPress={onCancel} style={confirmStyles.cancelBtn}>
              <Text style={confirmStyles.cancelText}>Odustani</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onConfirm} style={confirmStyles.confirmBtn}>
              <Text style={confirmStyles.confirmText}>{isUpdate ? 'Ažuriraj' : 'Pošalji'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const confirmStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 32 },
  card: { backgroundColor: 'white', borderRadius: 24, padding: 28, width: '100%', alignItems: 'center' },
  emoji: { fontSize: 44, marginBottom: 12 },
  title: { fontSize: 20, fontWeight: '800', color: '#111827', marginBottom: 8, textAlign: 'center' },
  sub: { fontSize: 14, color: '#6b7280', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  btns: { flexDirection: 'row', gap: 10, width: '100%' },
  cancelBtn: { flex: 1, backgroundColor: '#f3f4f6', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontSize: 15, fontWeight: '600', color: '#374151' },
  confirmBtn: { flex: 1, backgroundColor: '#78350f', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  confirmText: { fontSize: 15, fontWeight: '700', color: 'white' },
})

export default function CheckinScreen() {
  const [dailyParams, setDailyParams] = useState<Parameter[]>([])
  const [weeklyParams, setWeeklyParams] = useState<Parameter[]>([])
  const [config, setConfig] = useState<CheckinConfig | null>(null)
  const [dailyValues, setDailyValues] = useState<CheckinValues>({})
  const [checkinValues, setCheckinValues] = useState<CheckinValues>({})
  const [photos, setPhotos] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [savingDaily, setSavingDaily] = useState(false)
  const [savingCheckin, setSavingCheckin] = useState(false)
  const [existingCheckin, setExistingCheckin] = useState<ExistingCheckin | null>(null)
  const [existingDailyLog, setExistingDailyLog] = useState<DailyLog | null>(null)
  const [clientId, setClientId] = useState<string | null>(null)
  const [trainerId, setTrainerId] = useState<string | null>(null)
  const [lastCheckinDate, setLastCheckinDate] = useState<string | null>(null)
  const [dailySubmitted, setDailySubmitted] = useState(false)
  const [checkinSubmitted, setCheckinSubmitted] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: clientData } = await supabase.from('clients').select('id, trainer_id').eq('user_id', user.id).single()
    if (!clientData) return setLoading(false)
    setClientId(clientData.id); setTrainerId(clientData.trainer_id)
    const today = new Date().toISOString().split('T')[0]
    const [{ data: paramsData }, { data: configData }, { data: todayCheckin }, { data: todayDaily }, { data: lastCheckin }] = await Promise.all([
      supabase.from('checkin_parameters').select('*').eq('trainer_id', clientData.trainer_id).order('order_index'),
      supabase.from('checkin_config').select('checkin_day, photo_frequency, photo_positions').eq('client_id', clientData.id).single(),
      supabase.from('checkins').select('id, values, photo_urls, trainer_comment').eq('client_id', clientData.id).eq('date', today).single(),
      supabase.from('daily_logs').select('id, values').eq('client_id', clientData.id).eq('date', today).single(),
      supabase.from('checkins').select('date').eq('client_id', clientData.id).order('date', { ascending: false }).limit(2),
    ])
    if (paramsData) {
      setDailyParams(paramsData.filter((p: Parameter) => p.frequency === 'daily'))
      setWeeklyParams(paramsData.filter((p: Parameter) => p.frequency === 'weekly'))
    }
    if (configData) setConfig(configData)
    if (todayCheckin) { setExistingCheckin(todayCheckin); setCheckinValues(todayCheckin.values || {}); setCheckinSubmitted(true) }
    if (todayDaily) { setExistingDailyLog(todayDaily); setDailyValues(todayDaily.values || {}); setDailySubmitted(true) }
    const prevCheckin = lastCheckin?.find((c: any) => c.date !== today)
    setLastCheckinDate(prevCheckin?.date || null)
    setLoading(false)
  }

  const setDailyValue = (id: string, v: any) => setDailyValues(p => ({ ...p, [id]: v }))
  const setCheckinValue = (id: string, v: any) => setCheckinValues(p => ({ ...p, [id]: v }))

  const pickPhoto = async (position: string) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Greška', 'Potrebno je dopuštenje za pristup fotografijama.'); return }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, quality: 0.8 })
    if (!result.canceled && result.assets[0]) setPhotos(p => ({ ...p, [position]: result.assets[0].uri }))
  }

  const takePhoto = async (position: string) => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Greška', 'Potrebno je dopuštenje za kameru.'); return }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.8 })
    if (!result.canceled && result.assets[0]) setPhotos(p => ({ ...p, [position]: result.assets[0].uri }))
  }

  const uploadPhoto = async (uri: string, position: string): Promise<string | null> => {
    try {
      const response = await fetch(uri); const blob = await response.blob()
      const arrayBuffer = await new Response(blob).arrayBuffer()
      const uint8Array = new Uint8Array(arrayBuffer)
      const fileName = `${clientId}/${new Date().toISOString().split('T')[0]}_${position}_${Date.now()}.jpg`
      const { error } = await supabase.storage.from('checkin-images').upload(fileName, uint8Array, { contentType: 'image/jpeg', upsert: true })
      if (error) throw error
      return supabase.storage.from('checkin-images').getPublicUrl(fileName).data.publicUrl
    } catch (e) { console.error('Upload error:', e); return null }
  }

  const handleSaveDaily = async () => {
    if (!clientId || !trainerId) return
    const missing = dailyParams.filter(p => p.required && !dailyValues[p.id] && dailyValues[p.id] !== 0)
    if (missing.length > 0) { Alert.alert('Greška', `Popuni obavezna polja: ${missing.map(p => p.name).join(', ')}`); return }
    setSavingDaily(true)
    const today = new Date().toISOString().split('T')[0]
    if (existingDailyLog) {
      await supabase.from('daily_logs').update({ values: dailyValues }).eq('id', existingDailyLog.id)
    } else {
      const { data } = await supabase.from('daily_logs').insert({ client_id: clientId, trainer_id: trainerId, date: today, values: dailyValues }).select().single()
      if (data) setExistingDailyLog(data)
    }
    setSavingDaily(false); setDailySubmitted(true)
  }

  const handleSubmitCheckin = async () => {
    if (!clientId || !trainerId) return
    const missing = weeklyParams.filter(p => p.required && !checkinValues[p.id] && checkinValues[p.id] !== 0)
    if (missing.length > 0) { Alert.alert('Greška', `Popuni obavezna polja: ${missing.map(p => p.name).join(', ')}`); return }
    setSavingCheckin(true)
    const today = new Date().toISOString().split('T')[0]
    let uploadedUrls: Record<string, string> = {}
    for (const [position, uri] of Object.entries(photos)) {
      const url = await uploadPhoto(uri, position)
      if (url) uploadedUrls[position] = url
    }
    const photoUrlsArray = Object.entries(uploadedUrls).map(([position, url]) => ({ position, url }))
    const payload = { client_id: clientId, trainer_id: trainerId, date: today, values: checkinValues, photo_urls: photoUrlsArray.length > 0 ? photoUrlsArray : null }
    if (existingCheckin) {
      await supabase.from('checkins').update(payload).eq('id', existingCheckin.id)
    } else {
      await supabase.from('checkins').insert(payload)
    }
    setSavingCheckin(false); setCheckinSubmitted(true); setShowConfirm(false)
    Alert.alert('✓ Check-in poslan!', 'Trener će pregledati tvoj napredak.')
  }

  // ── Render one parameter ──────────────────────────────────────────────────
  const renderParam = (param: Parameter, values: CheckinValues, setter: (id: string, v: any) => void) => {
    const val = values[param.id]

    // NUMBER — compact row: big input + unit badge inline
    if (param.type === 'number') {
      return (
        <View key={param.id} style={styles.paramRow}>
          <Text style={styles.paramRowLabel}>
            {param.name}{param.required ? <Text style={styles.req}> *</Text> : null}
          </Text>
          <View style={styles.numberBox}>
            <TextInput
              style={styles.numberInput}
              value={val?.toString() || ''}
              onChangeText={v => setter(param.id, v)}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor="#d1d5db"
            />
            {param.unit && (
              <View style={styles.unitBox}>
                <Text style={styles.unitText}>{param.unit}</Text>
              </View>
            )}
          </View>
        </View>
      )
    }

    // TEXT — full card, multiline
    if (param.type === 'text') {
      return (
        <View key={param.id} style={styles.paramCard}>
          <Text style={styles.paramCardLabel}>
            {param.name}{param.required ? <Text style={styles.req}> *</Text> : null}
          </Text>
          <TextInput
            style={styles.textInput}
            value={val || ''}
            onChangeText={v => setter(param.id, v)}
            placeholder="Unesi tekst..."
            placeholderTextColor="#d1d5db"
            multiline
            numberOfLines={3}
          />
        </View>
      )
    }

    // BOOLEAN — full card, two big buttons
    if (param.type === 'boolean') {
      return (
        <View key={param.id} style={styles.paramCard}>
          <Text style={styles.paramCardLabel}>
            {param.name}{param.required ? <Text style={styles.req}> *</Text> : null}
          </Text>
          <View style={styles.boolRow}>
            {['Da', 'Ne'].map(opt => (
              <TouchableOpacity
                key={opt}
                style={[styles.boolBtn, val === (opt === 'Da') && styles.boolBtnActive]}
                onPress={() => setter(param.id, opt === 'Da')}
              >
                <Text style={[styles.boolText, val === (opt === 'Da') && styles.boolTextActive]}>{opt}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )
    }

    // SELECT — full card, pill options wrapping
    if (param.type === 'select' && param.options) {
      return (
        <View key={param.id} style={styles.paramCard}>
          <Text style={styles.paramCardLabel}>
            {param.name}{param.required ? <Text style={styles.req}> *</Text> : null}
          </Text>
          <View style={styles.selectRow}>
            {param.options.map(opt => (
              <TouchableOpacity
                key={opt}
                style={[styles.selectBtn, val === opt && styles.selectBtnActive]}
                onPress={() => setter(param.id, opt)}
              >
                <Text style={[styles.selectText, val === opt && styles.selectTextActive]}>{opt}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )
    }

    return null
  }

  const todayDay = new Date().getDay()
  const isCheckinDay = config?.checkin_day === todayDay
  const needsPhotos = shouldSendPhotos(config?.photo_frequency || null, lastCheckinDate)
  const photoPositions: string[] = config?.photo_positions || []

  if (loading) return <View style={styles.loadingContainer}><ActivityIndicator size="large" color="#f59e0b" /></View>

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">

        {/* Header */}
        <View style={styles.headerBg}>
          <Text style={styles.headerLabel}>Check-in</Text>
          <Text style={styles.headerTitle}>
            {new Date().toLocaleDateString('hr', { weekday: 'long', day: '2-digit', month: 'long' })}
          </Text>
          {config && (
            <Text style={styles.headerMeta}>
              📅 Tjedni check-in: {config.checkin_day !== null ? DAYS[config.checkin_day] : 'Nije postavljen'}
            </Text>
          )}
        </View>

        {/* ── DNEVNI UNOS ─────────────────────────────────────────── */}
        {dailyParams.length > 0 && (
          <View style={styles.block}>
            <View style={styles.blockHeader}>
              <View style={[styles.blockDot, { backgroundColor: '#f59e0b' }]} />
              <Text style={styles.blockTitle}>Dnevni unos</Text>
              {dailySubmitted && <View style={styles.pill}><Text style={styles.pillText}>✓ Uneseno danas</Text></View>}
            </View>

            <View style={styles.numberList}>
              {dailyParams.filter(p => p.type === 'number').map(p => renderParam(p, dailyValues, setDailyValue))}
            </View>
            {dailyParams.filter(p => p.type !== 'number').map(p => renderParam(p, dailyValues, setDailyValue))}

            <TouchableOpacity
              style={[styles.btn, { backgroundColor: dailySubmitted ? '#9ca3af' : '#f59e0b' }]}
              onPress={handleSaveDaily}
              disabled={savingDaily}
            >
              <Text style={styles.btnText}>
                {savingDaily ? 'Sprema...' : dailySubmitted ? '↺  Ažuriraj dnevni unos' : '✓  Spremi dnevni unos'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── DIVIDER ─────────────────────────────────────────────── */}
        {dailyParams.length > 0 && (weeklyParams.length > 0 || photoPositions.length > 0) && (
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerLabel}>tjedni check-in</Text>
            <View style={styles.dividerLine} />
          </View>
        )}

        {/* ── TJEDNI CHECK-IN ──────────────────────────────────────── */}
        {(weeklyParams.length > 0 || photoPositions.length > 0) && (
          <View style={styles.block}>
            <View style={styles.blockHeader}>
              <View style={[styles.blockDot, { backgroundColor: '#78350f' }]} />
              <Text style={styles.blockTitle}>Tjedni check-in</Text>
              <View style={[styles.pill, isCheckinDay ? styles.pillBlue : styles.pillGray]}>
                <Text style={[styles.pillText, isCheckinDay && { color: '#1d4ed8' }]}>
                  {isCheckinDay ? '📅 Danas' : config?.checkin_day !== null ? DAYS[config!.checkin_day!] : ''}
                </Text>
              </View>
            </View>

            {existingCheckin?.trainer_comment && (
              <View style={styles.commentCard}>
                <Text style={styles.commentLabel}>💬 Komentar trenera</Text>
                <Text style={styles.commentText}>{existingCheckin.trainer_comment}</Text>
              </View>
            )}

            {checkinSubmitted && (
              <View style={styles.submittedRow}>
                <Text style={styles.submittedEmoji}>✅</Text>
                <View>
                  <Text style={styles.submittedTitle}>Check-in poslan!</Text>
                  <Text style={styles.submittedSub}>Možeš ažurirati do kraja dana</Text>
                </View>
              </View>
            )}

            <View style={styles.numberList}>
              {weeklyParams.filter(p => p.type === 'number').map(p => renderParam(p, checkinValues, setCheckinValue))}
            </View>
            {weeklyParams.filter(p => p.type !== 'number').map(p => renderParam(p, checkinValues, setCheckinValue))}

            {/* Fotografije */}
            {needsPhotos && photoPositions.length > 0 && (
              <View style={styles.photosWrap}>
                <Text style={styles.photosTitle}>Fotografije</Text>
                <View style={styles.photosGrid}>
                  {photoPositions.map(position => {
                    const existingUrl = (existingCheckin?.photo_urls as any[])?.find((p: any) => p.position === position)?.url
                    const displayUri = photos[position] || existingUrl
                    return (
                      <View key={position} style={styles.photoCard}>
                        <Text style={styles.photoLabel}>{position}</Text>
                        {displayUri ? (
                          <TouchableOpacity onPress={() => Alert.alert(position, 'Odaberi', [
                            { text: 'Galerija', onPress: () => pickPhoto(position) },
                            { text: 'Kamera', onPress: () => takePhoto(position) },
                            { text: 'Odustani', style: 'cancel' },
                          ])}>
                            <Image source={{ uri: displayUri }} style={styles.photoImg} />
                            <Text style={styles.photoChangeText}>Promijeni</Text>
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity style={styles.photoEmpty} onPress={() => Alert.alert(position, 'Odaberi', [
                            { text: 'Galerija', onPress: () => pickPhoto(position) },
                            { text: 'Kamera', onPress: () => takePhoto(position) },
                            { text: 'Odustani', style: 'cancel' },
                          ])}>
                            <Text style={{ fontSize: 26, marginBottom: 6 }}>📷</Text>
                            <Text style={styles.photoEmptyText}>Dodaj foto</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )
                  })}
                </View>
              </View>
            )}

            <TouchableOpacity
              style={[styles.btn, { backgroundColor: checkinSubmitted ? '#9ca3af' : '#78350f' }]}
              onPress={() => setShowConfirm(true)}
              disabled={savingCheckin}
            >
              <Text style={styles.btnText}>
                {savingCheckin ? 'Šalje...' : checkinSubmitted ? '↺  Ažuriraj check-in' : '✓  Pošalji check-in'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {showConfirm && (
        <ConfirmCheckinModal
          isUpdate={checkinSubmitted}
          onConfirm={handleSubmitCheckin}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { paddingBottom: 32 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  headerBg: {
    backgroundColor: '#78350f', paddingTop: 60, paddingHorizontal: 20,
    paddingBottom: 24, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, marginBottom: 8,
  },
  headerLabel: { fontSize: 12, color: '#fcd34d', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: 'white', marginBottom: 8, textTransform: 'capitalize' },
  headerMeta: { fontSize: 13, color: 'rgba(255,255,255,0.75)' },

  // Block (dnevni / tjedni)
  block: { marginHorizontal: 16, marginTop: 16 },
  blockHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  blockDot: { width: 8, height: 8, borderRadius: 4 },
  blockTitle: { fontSize: 13, fontWeight: '700', color: '#374151', textTransform: 'uppercase', letterSpacing: 0.8, flex: 1 },

  pill: { backgroundColor: '#dcfce7', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 99 },
  pillGray: { backgroundColor: '#f3f4f6' },
  pillBlue: { backgroundColor: '#dbeafe' },
  pillText: { fontSize: 11, fontWeight: '600', color: '#15803d' },

  divider: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 20, gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#e5e7eb' },
  dividerLabel: { fontSize: 11, fontWeight: '600', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.8 },

  // ── Number params — compact horizontal list ──
  numberList: {
    backgroundColor: 'white', borderRadius: 16, marginBottom: 10, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  paramRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  paramRowLabel: { fontSize: 14, fontWeight: '600', color: '#374151', flex: 1 },
  req: { color: '#ef4444' },
  numberBox: {
    flexDirection: 'row', alignItems: 'stretch',
    borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, overflow: 'hidden', minWidth: 110,
  },
  numberInput: {
    width: 64, paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 17, fontWeight: '700', color: '#111827', textAlign: 'center',
  },
  unitBox: {
    backgroundColor: '#f9fafb', borderLeftWidth: 1, borderLeftColor: '#e5e7eb',
    paddingHorizontal: 10, paddingVertical: 8, justifyContent: 'center',
  },
  unitText: { fontSize: 13, fontWeight: '600', color: '#9ca3af' },

  // ── Full-width cards (text, bool, select) ──
  paramCard: {
    backgroundColor: 'white', borderRadius: 16, marginBottom: 10, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  paramCardLabel: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 10 },

  textInput: {
    borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14,
    color: '#111827', minHeight: 72, textAlignVertical: 'top',
  },

  boolRow: { flexDirection: 'row', gap: 10 },
  boolBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: '#e5e7eb', alignItems: 'center' },
  boolBtnActive: { backgroundColor: '#f59e0b', borderColor: '#f59e0b' },
  boolText: { fontSize: 15, fontWeight: '600', color: '#6b7280' },
  boolTextActive: { color: 'white' },

  selectRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  selectBtn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 99, borderWidth: 1, borderColor: '#e5e7eb' },
  selectBtnActive: { backgroundColor: '#f59e0b', borderColor: '#f59e0b' },
  selectText: { fontSize: 14, color: '#6b7280', fontWeight: '500' },
  selectTextActive: { color: 'white', fontWeight: '700' },

  // ── Action button ──
  btn: { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 6 },
  btnText: { color: 'white', fontSize: 15, fontWeight: '700' },

  // ── Info cards ──
  commentCard: { backgroundColor: '#eff6ff', borderRadius: 14, padding: 14, marginBottom: 10, borderLeftWidth: 3, borderLeftColor: '#3b82f6' },
  commentLabel: { fontSize: 12, fontWeight: '700', color: '#1d4ed8', marginBottom: 4 },
  commentText: { fontSize: 13, color: '#1e40af', lineHeight: 20 },
  submittedRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#f0fdf4', borderRadius: 14, marginBottom: 10, padding: 14, borderWidth: 1, borderColor: '#86efac' },
  submittedEmoji: { fontSize: 28 },
  submittedTitle: { fontSize: 15, fontWeight: '700', color: '#15803d' },
  submittedSub: { fontSize: 12, color: '#4ade80', marginTop: 2 },

  // ── Photos ──
  photosWrap: { marginTop: 4, marginBottom: 4 },
  photosTitle: { fontSize: 11, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  photosGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  photoCard: { width: '47%' },
  photoLabel: { fontSize: 12, fontWeight: '600', color: '#6b7280', marginBottom: 6, textTransform: 'capitalize' },
  photoImg: { width: '100%', height: 130, borderRadius: 12, backgroundColor: '#f3f4f6' },
  photoChangeText: { fontSize: 11, color: '#9ca3af', textAlign: 'center', marginTop: 4 },
  photoEmpty: { width: '100%', height: 130, borderRadius: 12, borderWidth: 2, borderColor: '#e5e7eb', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', backgroundColor: 'white' },
  photoEmptyText: { fontSize: 12, color: '#9ca3af' },
})
