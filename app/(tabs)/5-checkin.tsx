import { supabase } from '@/lib/supabase'
import * as ImagePicker from 'expo-image-picker'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert, Image, KeyboardAvoidingView, Platform,
  ScrollView, StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native'

type Parameter = {
  id: string
  name: string
  type: string
  unit: string | null
  options: string[] | null
  required: boolean
  order_index: number
  frequency: string
}

type CheckinConfig = {
  checkin_day: number | null
  photo_frequency: string | null
  photo_positions: string[] | null
}

type CheckinValues = Record<string, any>

type ExistingCheckin = {
  id: string
  values: CheckinValues
  photo_urls: any[] | null
  trainer_comment: string | null
}

type DailyLog = {
  id: string
  values: CheckinValues
}

const DAYS = ['Nedjelja', 'Ponedjeljak', 'Utorak', 'Srijeda', 'Četvrtak', 'Petak', 'Subota']

const shouldSendPhotos = (frequency: string | null, lastCheckinDate: string | null): boolean => {
  if (!frequency) return false
  if (frequency === 'every' || frequency === 'weekly') return true
  if (frequency === 'biweekly') {
    if (!lastCheckinDate) return true
    const diffDays = Math.floor((new Date().getTime() - new Date(lastCheckinDate).getTime()) / (1000 * 60 * 60 * 24))
    return diffDays >= 14
  }
  if (frequency === 'monthly') {
    if (!lastCheckinDate) return true
    const last = new Date(lastCheckinDate)
    const now = new Date()
    return last.getMonth() !== now.getMonth() || last.getFullYear() !== now.getFullYear()
  }
  return false
}

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

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: clientData } = await supabase
      .from('clients').select('id, trainer_id').eq('user_id', user.id).single()
    if (!clientData) return setLoading(false)

    setClientId(clientData.id)
    setTrainerId(clientData.trainer_id)

    const today = new Date().toISOString().split('T')[0]

    const [
      { data: paramsData },
      { data: configData },
      { data: todayCheckin },
      { data: todayDaily },
      { data: lastCheckin },
    ] = await Promise.all([
      supabase.from('checkin_parameters')
        .select('*').eq('trainer_id', clientData.trainer_id).order('order_index'),
      supabase.from('checkin_config')
        .select('checkin_day, photo_frequency, photo_positions')
        .eq('client_id', clientData.id).single(),
      supabase.from('checkins')
        .select('id, values, photo_urls, trainer_comment')
        .eq('client_id', clientData.id).eq('date', today).single(),
      supabase.from('daily_logs')
        .select('id, values')
        .eq('client_id', clientData.id).eq('date', today).single(),
      supabase.from('checkins')
        .select('date').eq('client_id', clientData.id)
        .order('date', { ascending: false }).limit(2),
    ])

    if (paramsData) {
      setDailyParams(paramsData.filter((p: Parameter) => p.frequency === 'daily'))
      setWeeklyParams(paramsData.filter((p: Parameter) => p.frequency === 'weekly'))
    }
    if (configData) setConfig(configData)

    if (todayCheckin) {
      setExistingCheckin(todayCheckin)
      setCheckinValues(todayCheckin.values || {})
      setCheckinSubmitted(true)
    }

    if (todayDaily) {
      setExistingDailyLog(todayDaily)
      setDailyValues(todayDaily.values || {})
      setDailySubmitted(true)
    }

    const prevCheckin = lastCheckin?.find(c => c.date !== today)
    setLastCheckinDate(prevCheckin?.date || null)

    setLoading(false)
  }

  const setDailyValue = (paramId: string, value: any) => {
    setDailyValues(prev => ({ ...prev, [paramId]: value }))
  }

  const setCheckinValue = (paramId: string, value: any) => {
    setCheckinValues(prev => ({ ...prev, [paramId]: value }))
  }

  const pickPhoto = async (position: string) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Greška', 'Potrebno je dopuštenje za pristup fotografijama.'); return }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, quality: 0.8 })
    if (!result.canceled && result.assets[0]) setPhotos(prev => ({ ...prev, [position]: result.assets[0].uri }))
  }

  const takePhoto = async (position: string) => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Greška', 'Potrebno je dopuštenje za kameru.'); return }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.8 })
    if (!result.canceled && result.assets[0]) setPhotos(prev => ({ ...prev, [position]: result.assets[0].uri }))
  }

  const uploadPhoto = async (uri: string, position: string): Promise<string | null> => {
    try {
      const response = await fetch(uri)
      const blob = await response.blob()
      const arrayBuffer = await new Response(blob).arrayBuffer()
      const uint8Array = new Uint8Array(arrayBuffer)
      const fileName = `${clientId}/${new Date().toISOString().split('T')[0]}_${position}_${Date.now()}.jpg`
      const { error } = await supabase.storage.from('checkin-images').upload(fileName, uint8Array, { contentType: 'image/jpeg', upsert: true })
      if (error) throw error
      const { data: urlData } = supabase.storage.from('checkin-images').getPublicUrl(fileName)
      return urlData.publicUrl
    } catch (e) { console.error('Upload error:', e); return null }
  }

  const handleSaveDaily = async () => {
    if (!clientId || !trainerId) return
    const missing = dailyParams.filter(p => p.required && !dailyValues[p.id] && dailyValues[p.id] !== 0)
    if (missing.length > 0) {
      Alert.alert('Greška', `Popuni obavezna polja: ${missing.map(p => p.name).join(', ')}`)
      return
    }
    setSavingDaily(true)
    const today = new Date().toISOString().split('T')[0]
    const payload = { client_id: clientId, trainer_id: trainerId, date: today, values: dailyValues }

    if (existingDailyLog) {
      await supabase.from('daily_logs').update({ values: dailyValues }).eq('id', existingDailyLog.id)
    } else {
      const { data } = await supabase.from('daily_logs').insert(payload).select().single()
      if (data) setExistingDailyLog(data)
    }
    setSavingDaily(false)
    setDailySubmitted(true)
  }

  const handleSubmitCheckin = async () => {
    if (!clientId || !trainerId) return
    const missing = weeklyParams.filter(p => p.required && !checkinValues[p.id] && checkinValues[p.id] !== 0)
    if (missing.length > 0) {
      Alert.alert('Greška', `Popuni obavezna polja: ${missing.map(p => p.name).join(', ')}`)
      return
    }
    setSavingCheckin(true)
    const today = new Date().toISOString().split('T')[0]

    let uploadedUrls: Record<string, string> = {}
    for (const [position, uri] of Object.entries(photos)) {
      const url = await uploadPhoto(uri, position)
      if (url) uploadedUrls[position] = url
    }
    const photoUrlsArray = Object.entries(uploadedUrls).map(([position, url]) => ({ position, url }))

    const payload = {
      client_id: clientId,
      trainer_id: trainerId,
      date: today,
      values: checkinValues,
      photo_urls: photoUrlsArray.length > 0 ? photoUrlsArray : null,
    }

    if (existingCheckin) {
      await supabase.from('checkins').update(payload).eq('id', existingCheckin.id)
    } else {
      await supabase.from('checkins').insert(payload)
    }

    setSavingCheckin(false)
    setCheckinSubmitted(true)
    Alert.alert('✓ Check-in poslan!', 'Trener će pregledati tvoj napredak.')
  }

  const renderParam = (
    param: Parameter,
    values: CheckinValues,
    setter: (id: string, value: any) => void
  ) => (
    <View key={param.id} style={styles.paramCard}>
      <View style={styles.paramHeader}>
        <Text style={styles.paramName}>
          {param.name}
          {param.required && <Text style={styles.paramRequired}> *</Text>}
        </Text>
        {param.unit && <Text style={styles.paramUnit}>{param.unit}</Text>}
      </View>

      {param.type === 'number' && (
        <TextInput
          style={styles.paramInput}
          value={values[param.id]?.toString() || ''}
          onChangeText={v => setter(param.id, v)}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor="#d1d5db"
        />
      )}

      {param.type === 'text' && (
        <TextInput
          style={[styles.paramInput, styles.paramInputMulti]}
          value={values[param.id] || ''}
          onChangeText={v => setter(param.id, v)}
          placeholder="Unesi tekst..."
          placeholderTextColor="#d1d5db"
          multiline
          numberOfLines={3}
        />
      )}

      {param.type === 'boolean' && (
        <View style={styles.boolRow}>
          {['Da', 'Ne'].map(opt => (
            <TouchableOpacity
              key={opt}
              style={[styles.boolBtn, values[param.id] === (opt === 'Da') && styles.boolBtnActive]}
              onPress={() => setter(param.id, opt === 'Da')}
            >
              <Text style={[styles.boolBtnText, values[param.id] === (opt === 'Da') && styles.boolBtnTextActive]}>
                {opt}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {param.type === 'select' && param.options && (
        <View style={styles.selectRow}>
          {param.options.map(opt => (
            <TouchableOpacity
              key={opt}
              style={[styles.selectBtn, values[param.id] === opt && styles.selectBtnActive]}
              onPress={() => setter(param.id, opt)}
            >
              <Text style={[styles.selectBtnText, values[param.id] === opt && styles.selectBtnTextActive]}>
                {opt}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  )

  const todayDay = new Date().getDay()
  const isCheckinDay = config?.checkin_day === todayDay
  const needsPhotos = shouldSendPhotos(config?.photo_frequency || null, lastCheckinDate)
  const photoPositions: string[] = config?.photo_positions || []

  if (loading) return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color="#f59e0b" />
    </View>
  )

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {/* Header */}
        <View style={styles.headerBg}>
          <Text style={styles.headerLabel}>Dnevni unos</Text>
          <Text style={styles.headerTitle}>
            {new Date().toLocaleDateString('hr', { weekday: 'long', day: '2-digit', month: 'long' })}
          </Text>
          {config && (
            <Text style={styles.headerMetaText}>
              📅 Tjedni check-in: {config.checkin_day !== null ? DAYS[config.checkin_day] : 'Nije postavljen'}
            </Text>
          )}
        </View>

        {/* DNEVNI UNOS */}
        {dailyParams.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Danas</Text>
              {dailySubmitted && (
                <View style={styles.doneBadge}>
                  <Text style={styles.doneBadgeText}>✓ Uneseno</Text>
                </View>
              )}
            </View>

            {dailyParams.map(p => renderParam(p, dailyValues, setDailyValue))}
          </>
        )}

        {/* TJEDNI CHECK-IN */}
        {(weeklyParams.length > 0 || photoPositions.length > 0) && (
          <>
            <View style={[styles.sectionHeader, { marginTop: 8 }]}>
              <Text style={styles.sectionTitle}>Tjedni check-in</Text>
              <View style={[styles.doneBadge, isCheckinDay ? styles.doneBadgeBlue : styles.doneBadgeGray]}>
                <Text style={styles.doneBadgeText}>
                  {isCheckinDay ? 'Danas!' : DAYS[config?.checkin_day ?? 0]}
                </Text>
              </View>
            </View>

            {existingCheckin?.trainer_comment && (
              <View style={styles.trainerCommentCard}>
                <Text style={styles.trainerCommentLabel}>💬 Komentar trenera</Text>
                <Text style={styles.trainerCommentText}>{existingCheckin.trainer_comment}</Text>
              </View>
            )}

            {checkinSubmitted && (
              <View style={styles.submittedBanner}>
                <Text style={styles.submittedEmoji}>✅</Text>
                <View>
                  <Text style={styles.submittedTitle}>Check-in poslan!</Text>
                  <Text style={styles.submittedSub}>Možeš ažurirati do kraja dana</Text>
                </View>
              </View>
            )}

            {weeklyParams.map(p => renderParam(p, checkinValues, setCheckinValue))}

            {/* Fotografije */}
            {needsPhotos && photoPositions.length > 0 && (
              <>
                <Text style={[styles.sectionTitle, { marginHorizontal: 20, marginTop: 8 }]}>Fotografije</Text>
                <View style={styles.photosGrid}>
                  {photoPositions.map(position => {
                    const existingUrl = (existingCheckin?.photo_urls as any[])?.find((p: any) => p.position === position)?.url
                    const localUri = photos[position]
                    const displayUri = localUri || existingUrl

                    return (
                      <View key={position} style={styles.photoCard}>
                        <Text style={styles.photoPosition}>{position}</Text>
                        {displayUri ? (
                          <TouchableOpacity onPress={() => Alert.alert(position, 'Odaberi', [
                            { text: 'Galerija', onPress: () => pickPhoto(position) },
                            { text: 'Kamera', onPress: () => takePhoto(position) },
                            { text: 'Odustani', style: 'cancel' },
                          ])}>
                            <Image source={{ uri: displayUri }} style={styles.photoPreview} />
                            <Text style={styles.photoChange}>Promijeni</Text>
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity
                            style={styles.photoUploadBtn}
                            onPress={() => Alert.alert(position, 'Odaberi', [
                              { text: 'Galerija', onPress: () => pickPhoto(position) },
                              { text: 'Kamera', onPress: () => takePhoto(position) },
                              { text: 'Odustani', style: 'cancel' },
                            ])}
                          >
                            <Text style={styles.photoUploadIcon}>📷</Text>
                            <Text style={styles.photoUploadText}>Dodaj foto</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )
                  })}
                </View>
              </>
            )}
          </>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* Sticky footer */}
      <View style={styles.stickyFooter}>
        {dailyParams.length > 0 && (
          <TouchableOpacity
            style={[styles.saveBtn, dailySubmitted && styles.saveBtnDone, { marginHorizontal: 0, marginBottom: 0 }]}
            onPress={handleSaveDaily}
            disabled={savingDaily}
          >
            <Text style={styles.saveBtnText}>
              {savingDaily ? 'Sprema...' : dailySubmitted ? '↺ Ažuriraj dnevni unos' : '✓ Spremi dnevni unos'}
            </Text>
          </TouchableOpacity>
        )}
        {(weeklyParams.length > 0 || photoPositions.length > 0) && (
          <TouchableOpacity
            style={[styles.checkinBtn, checkinSubmitted && styles.checkinBtnUpdate, { marginTop: dailyParams.length > 0 ? 8 : 0 }]}
            onPress={handleSubmitCheckin}
            disabled={savingCheckin}
          >
            <Text style={styles.checkinBtnText}>
              {savingCheckin ? 'Šalje...' : checkinSubmitted ? '↺ Ažuriraj check-in' : '✓ Pošalji check-in'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { paddingBottom: 32 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  stickyFooter: {
    padding: 16,
    backgroundColor: 'white',
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  headerBg: {
    backgroundColor: '#78350f',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 24,
    borderBottomLeftRadius: 28, borderBottomRightRadius: 28, marginBottom: 16,
  },
  headerLabel: { fontSize: 12, color: '#fcd34d', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: 'white', marginBottom: 8, textTransform: 'capitalize' },
  headerMetaText: { fontSize: 13, color: 'rgba(255,255,255,0.75)' },

  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 20, marginBottom: 10,
  },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.8 },
  doneBadge: { backgroundColor: '#dcfce7', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 99 },
  doneBadgeBlue: { backgroundColor: '#dbeafe' },
  doneBadgeGray: { backgroundColor: '#f3f4f6' },
  doneBadgeText: { fontSize: 11, fontWeight: '600', color: '#15803d' },

  submittedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#f0fdf4', borderRadius: 14, marginHorizontal: 20,
    marginBottom: 12, padding: 14, borderWidth: 1, borderColor: '#86efac',
  },
  submittedEmoji: { fontSize: 28 },
  submittedTitle: { fontSize: 15, fontWeight: '700', color: '#15803d' },
  submittedSub: { fontSize: 12, color: '#4ade80', marginTop: 2 },

  trainerCommentCard: {
    backgroundColor: '#eff6ff', borderRadius: 14, padding: 14,
    marginHorizontal: 20, marginBottom: 12,
    borderLeftWidth: 3, borderLeftColor: '#3b82f6',
  },
  trainerCommentLabel: { fontSize: 12, fontWeight: '700', color: '#1d4ed8', marginBottom: 4 },
  trainerCommentText: { fontSize: 13, color: '#1e40af', lineHeight: 20 },

  paramCard: {
    backgroundColor: 'white', borderRadius: 16, marginHorizontal: 20,
    marginBottom: 10, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  paramHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  paramName: { fontSize: 14, fontWeight: '600', color: '#111827' },
  paramRequired: { color: '#ef4444' },
  paramUnit: { fontSize: 12, color: '#9ca3af', backgroundColor: '#f3f4f6', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99 },
  paramInput: {
    borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, fontWeight: '600', color: '#111827',
  },
  paramInputMulti: { height: 80, textAlignVertical: 'top', fontWeight: '400' },

  boolRow: { flexDirection: 'row', gap: 10 },
  boolBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: '#e5e7eb', alignItems: 'center' },
  boolBtnActive: { backgroundColor: '#f59e0b', borderColor: '#f59e0b' },
  boolBtnText: { fontSize: 14, fontWeight: '600', color: '#6b7280' },
  boolBtnTextActive: { color: 'white' },

  selectRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  selectBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, borderWidth: 1, borderColor: '#e5e7eb' },
  selectBtnActive: { backgroundColor: '#f59e0b', borderColor: '#f59e0b' },
  selectBtnText: { fontSize: 13, color: '#6b7280', fontWeight: '500' },
  selectBtnTextActive: { color: 'white' },

  saveBtn: {
    backgroundColor: '#f59e0b', borderRadius: 14, marginHorizontal: 20,
    paddingVertical: 14, alignItems: 'center', marginBottom: 20,
  },
  saveBtnDone: { backgroundColor: '#9ca3af' },
  saveBtnText: { color: 'white', fontSize: 15, fontWeight: '700' },

  checkinBtn: {
    backgroundColor: '#78350f', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
  },
  checkinBtnUpdate: { backgroundColor: '#6b7280' },
  checkinBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },

  photosGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 20, marginBottom: 16 },
  photoCard: { width: '47%' },
  photoPosition: { fontSize: 12, fontWeight: '600', color: '#6b7280', marginBottom: 6, textTransform: 'capitalize' },
  photoPreview: { width: '100%', height: 140, borderRadius: 12, backgroundColor: '#f3f4f6' },
  photoChange: { fontSize: 11, color: '#9ca3af', textAlign: 'center', marginTop: 4 },
  photoUploadBtn: {
    width: '100%', height: 140, borderRadius: 12,
    borderWidth: 2, borderColor: '#e5e7eb', borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'white',
  },
  photoUploadIcon: { fontSize: 28, marginBottom: 6 },
  photoUploadText: { fontSize: 12, color: '#9ca3af' },
})