import { supabase } from '@/lib/supabase'
import { useLanguage } from '@/lib/LanguageContext'
import { useClient } from '@/lib/ClientContext'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as ImagePicker from 'expo-image-picker'
import { useRouter, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal,
  Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

const getToday = () => {
  const now = new Date(Date.now() - 4 * 60 * 60 * 1000)
  return now.toISOString().split('T')[0]
}

const MAX_BACK_DAYS = 3

/** Timezone-safe date offset using UTC math on ISO date strings (same as nutrition). */
const offsetDate = (dateStr: string, days: number): string => {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().split('T')[0]
}

type Parameter = {
  id: string; name: string; type: string; unit: string | null
  options: string[] | null; required: boolean; order_index: number; frequency: string
}
type CheckinConfig = { checkin_day: number | null; photo_frequency: string | null; photo_positions: string[] | null }
type CheckinValues = Record<string, any>
type ExistingCheckin = { id: string; values: CheckinValues; photo_urls: any[] | null; trainer_comment: string | null }
type DailyLog = { id: string; values: CheckinValues }

// DAYS is now derived from i18n inside components

/** `refDate` = day being edited (YYYY-MM-DD); used for retro check-ins, not wall-clock "now". */
const shouldSendPhotos = (frequency: string | null, lastCheckinDate: string | null, refDate: string): boolean => {
  if (!frequency) return false
  if (frequency === 'every' || frequency === 'weekly') return true
  const ref = new Date(`${refDate}T12:00:00`)
  if (frequency === 'biweekly') {
    if (!lastCheckinDate) return true
    return Math.floor((ref.getTime() - new Date(`${lastCheckinDate}T12:00:00`).getTime()) / 86400000) >= 14
  }
  if (frequency === 'monthly') {
    if (!lastCheckinDate) return true
    const last = new Date(`${lastCheckinDate}T12:00:00`)
    return last.getMonth() !== ref.getMonth() || last.getFullYear() !== ref.getFullYear()
  }
  return false
}

// ── Confirm modal ─────────────────────────────────────────────────────────────
function ConfirmCheckinModal({ onConfirm, onCancel, isUpdate }: { onConfirm: () => void; onCancel: () => void; isUpdate: boolean }) {
  const { t } = useLanguage()
  return (
    <Modal visible animationType="fade" transparent onRequestClose={onCancel}>
      <View style={confirmStyles.overlay}>
        <View style={confirmStyles.card}>
          <Text style={confirmStyles.title}>{isUpdate ? t('ci_update_confirm') : t('ci_checkin_confirm')}</Text>
          <Text style={confirmStyles.sub}>
            {isUpdate ? t('ci_update_confirm_msg') : t('ci_checkin_confirm_msg')}
          </Text>
          <View style={confirmStyles.btns}>
            <TouchableOpacity onPress={onCancel} style={confirmStyles.cancelBtn}>
              <Text style={confirmStyles.cancelText}>{t('cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onConfirm} style={confirmStyles.confirmBtn}>
              <Text style={confirmStyles.confirmText}>{isUpdate ? t('update') : t('send')}</Text>
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
  title: { fontSize: 20, fontWeight: '800', color: '#111827', marginBottom: 8, textAlign: 'center' },
  sub: { fontSize: 14, color: '#6b7280', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  btns: { flexDirection: 'row', gap: 10, width: '100%' },
  cancelBtn: { flex: 1, backgroundColor: '#f3f4f6', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontSize: 15, fontWeight: '600', color: '#374151' },
  confirmBtn: { flex: 1, backgroundColor: '#78350f', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  confirmText: { fontSize: 15, fontWeight: '700', color: 'white' },
})

export default function CheckinScreen() {
  const router = useRouter()
  const { t, lang } = useLanguage()
  const {
    clientData: ctxClient,
    checkinConfig: ctxCheckinConfig,
    checkinParams: ctxCheckinParams,
    clientCreatedAt: ctxClientCreatedAt,
  } = useClient()
  const locale = lang === 'en' ? 'en' : 'hr'
  const insets = useSafeAreaInsets()
  const DAYS = t('days_long').split(',')
  const [dailyParams, setDailyParams] = useState<Parameter[]>([])
  const [weeklyParams, setWeeklyParams] = useState<Parameter[]>([])
  const [config, setConfig] = useState<CheckinConfig | null>(null)
  const [dailyValues, setDailyValues] = useState<CheckinValues>({})
  const [checkinValues, setCheckinValues] = useState<CheckinValues>({})
  const [photos, setPhotos] = useState<Record<string, string>>({})
  /** First full load (bootstrap + first day). Date changes use `syncing` only. */
  const [ready, setReady] = useState(() => !ctxClient?.clientId)
  const [syncing, setSyncing] = useState(false)
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
  const [resolvedExistingUrls, setResolvedExistingUrls] = useState<Record<string, string>>({})
  const [isLate, setIsLate] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [draftRestored, setDraftRestored] = useState(false)
  /** Latest check-in with a trainer comment (fallback when selected day has none). */
  const [latestTrainerComment, setLatestTrainerComment] = useState<{ comment: string; date: string } | null>(null)
  const [selectedDate, setSelectedDate] = useState(getToday)
  const [minDate, setMinDate] = useState<string | null>(null)
  const [bootstrapReady, setBootstrapReady] = useState(false)
  const dailyParamsRef = useRef<Parameter[]>([])
  const lastParamsFetchRef = useRef<number>(0)
  dailyParamsRef.current = dailyParams
  const firstDayLoaded = useRef(false)
  const dayLoadSeq = useRef(0)

  const today = getToday()
  const hardMin = offsetDate(today, -MAX_BACK_DAYS)
  const effectiveMin = minDate && minDate > hardMin ? minDate : hardMin
  const canGoBack = selectedDate > effectiveMin
  const canGoForward = selectedDate < today

  const fmtSelectedDate = (dateStr: string): string => {
    if (dateStr === today) return t('today')
    const yesterday = offsetDate(today, -1)
    if (dateStr === yesterday) return lang === 'hr' ? 'Jučer' : 'Yesterday'
    const [y, m, d] = dateStr.split('-').map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d))
    return dt.toLocaleDateString(lang === 'hr' ? 'hr' : 'en', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  }

  // Bootstrap: parameters, config, client min date.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const cId = ctxClient?.clientId
      const tId = ctxClient?.trainerId
      if (!cId || !tId) {
        setBootstrapReady(false)
        firstDayLoaded.current = false
        setReady(true)
        return
      }
      setBootstrapReady(false)
      firstDayLoaded.current = false
      setReady(false)
      // Use context-cached data when available — avoids redundant network calls
      const hasCtxParams = ctxCheckinParams.length > 0
      const hasCtxConfig = !!ctxCheckinConfig
      const hasCtxCreatedAt = !!ctxClientCreatedAt

      const [{ data: latestCommentRow }, { data: paramsFallback }, { data: configFallback }, { data: clientRow }] = await Promise.all([
        supabase
          .from('checkins')
          .select('trainer_comment, date')
          .eq('client_id', cId)
          .not('trainer_comment', 'is', null)
          .neq('trainer_comment', '')
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle(),
        hasCtxParams
          ? Promise.resolve({ data: null as any })
          : supabase.from('checkin_parameters').select('*').eq('trainer_id', tId).order('order_index') as any,
        hasCtxConfig
          ? Promise.resolve({ data: null as any })
          : supabase.from('checkin_config').select('checkin_day, photo_frequency, photo_positions').eq('client_id', cId).maybeSingle() as any,
        hasCtxCreatedAt
          ? Promise.resolve({ data: null as any })
          : supabase.from('clients').select('created_at').eq('id', cId).maybeSingle() as any,
      ])

      const paramsData = hasCtxParams ? ctxCheckinParams : paramsFallback
      const configData = hasCtxConfig ? ctxCheckinConfig : configFallback
      if (cancelled) return
      if (paramsData) {
        setDailyParams(paramsData.filter((p: Parameter) => p.frequency === 'daily'))
        setWeeklyParams(paramsData.filter((p: Parameter) => p.frequency === 'weekly'))
      }
      if (configData) setConfig(configData as any)
      const createdAt = ctxClientCreatedAt ?? clientRow?.created_at?.split('T')[0] ?? null
      if (createdAt) setMinDate(createdAt)
      setClientId(cId)
      setTrainerId(tId)
      if (latestCommentRow?.trainer_comment?.trim()) {
        setLatestTrainerComment({ comment: latestCommentRow.trainer_comment.trim(), date: latestCommentRow.date })
      } else {
        setLatestTrainerComment(null)
      }
      setBootstrapReady(true)
    })()
    return () => { cancelled = true }
  }, [ctxClient])

  // Osvježi zadnji komentar trenera i (ako je prošlo 15 min) params/config kad se otvori tab.
  useFocusEffect(
    useCallback(() => {
      const cId = clientId
      const tId = ctxClient?.trainerId
      if (!cId) return
      let cancelled = false
      ;(async () => {
        const { data } = await supabase
          .from('checkins')
          .select('trainer_comment, date')
          .eq('client_id', cId)
          .not('trainer_comment', 'is', null)
          .neq('trainer_comment', '')
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (cancelled) return
        if (data?.trainer_comment?.trim()) {
          setLatestTrainerComment({ comment: data.trainer_comment.trim(), date: data.date })
        } else {
          setLatestTrainerComment(null)
        }

        // Silently re-fetch params + config if stale (15 min)
        if (!tId || Date.now() - lastParamsFetchRef.current <= 15 * 60 * 1000) return
        const [{ data: paramsData }, { data: configData }] = await Promise.all([
          supabase.from('checkin_parameters').select('*').eq('trainer_id', tId).order('order_index'),
          supabase.from('checkin_config').select('checkin_day, photo_frequency, photo_positions').eq('client_id', cId).maybeSingle(),
        ])
        if (cancelled) return
        if (paramsData) {
          setDailyParams(paramsData.filter((p: Parameter) => p.frequency === 'daily'))
          setWeeklyParams(paramsData.filter((p: Parameter) => p.frequency === 'weekly'))
        }
        if (configData) setConfig(configData as any)
        lastParamsFetchRef.current = Date.now()
      })()
      return () => { cancelled = true }
    }, [clientId, ctxClient?.trainerId]),
  )

  // Load check-in + daily log + drafts for the selected day (up to 3 days back, same window as nutrition).
  useEffect(() => {
    if (!bootstrapReady || !clientId || !trainerId) return
    let cancelled = false
    const loadId = ++dayLoadSeq.current
    ;(async () => {
      try {
      const dateStr = selectedDate
      const cId = clientId
      if (firstDayLoaded.current) setSyncing(true)
      setPhotos({})
      setResolvedExistingUrls({})

      const [{ data: dayCheckin }, { data: dayDaily }, { data: priorCheckin }] = await Promise.all([
        supabase.from('checkins').select('id, values, photo_urls, trainer_comment').eq('client_id', cId).eq('date', dateStr).maybeSingle(),
        supabase.from('daily_logs').select('id, values').eq('client_id', cId).eq('date', dateStr).maybeSingle(),
        supabase.from('checkins').select('date').eq('client_id', cId).lt('date', dateStr).order('date', { ascending: false }).limit(1).maybeSingle(),
      ])
      if (cancelled) return

      setLastCheckinDate(priorCheckin?.date ?? null)

      // Late warning only for "today" view
      if (dateStr === today && config?.checkin_day !== null && config?.checkin_day !== undefined) {
        const { data: lastFew } = await supabase.from('checkins').select('date').eq('client_id', cId).order('date', { ascending: false }).limit(10)
        if (cancelled) return
        const todayDayNum = new Date().getDay()
        const daysSince = (todayDayNum - config.checkin_day + 7) % 7
        if (daysSince > 0) {
          const expectedDate = new Date()
          expectedDate.setDate(expectedDate.getDate() - daysSince)
          const expectedStr = `${expectedDate.getFullYear()}-${String(expectedDate.getMonth() + 1).padStart(2, '0')}-${String(expectedDate.getDate()).padStart(2, '0')}`
          const hasCheckinThisWeek = lastFew?.some((c: any) => c.date >= expectedStr)
          setIsLate(!hasCheckinThisWeek)
        } else {
          setIsLate(false)
        }
      } else {
        setIsLate(false)
      }

      if (dayCheckin) {
        setExistingCheckin(dayCheckin)
        setCheckinValues(dayCheckin.values || {})
        setCheckinSubmitted(true)
        const existingPhotoUrls: any[] = dayCheckin.photo_urls || []
        const paths = existingPhotoUrls.map((p: any) => p?.url).filter((u: string) => u && !u.startsWith('http'))
        if (paths.length) {
          const { data: signed } = await supabase.storage.from('checkin-images').createSignedUrls(paths, 3600)
          if (cancelled) return
          if (signed) {
            const urlMap: Record<string, string> = Object.fromEntries(
              signed.filter((s: any) => s.path && s.signedUrl).map((s: any) => [s.path, s.signedUrl])
            )
            const resolved: Record<string, string> = {}
            existingPhotoUrls.forEach((p: any) => { if (p?.position && p?.url) resolved[p.position] = urlMap[p.url] ?? p.url })
            setResolvedExistingUrls(resolved)
          }
        }
      } else {
        setExistingCheckin(null)
        setCheckinSubmitted(false)
        // Restore in-progress weekly draft if one exists
        try {
          const wKey = `weekly-draft-${cId}-${dateStr}`
          const raw = await AsyncStorage.getItem(wKey)
          if (raw) {
            setCheckinValues(JSON.parse(raw))
          } else {
            setCheckinValues({})
          }
        } catch {
          setCheckinValues({})
        }
      }

      if (dayDaily) {
        setExistingDailyLog(dayDaily)
        setDailyValues(dayDaily.values || {})
        const dailyParamIds = dailyParamsRef.current.map((p: Parameter) => p.id)
        const hasActualValues = dailyParamIds.some(
          (id: string) => dayDaily.values?.[id] != null && dayDaily.values[id] !== '',
        )
        setDailySubmitted(hasActualValues)
        setDraftRestored(false)
      } else {
        setExistingDailyLog(null)
        setDailyValues({})
        setDailySubmitted(false)
        try {
          const key = `daily-draft-${cId}-${dateStr}`
          let raw = await AsyncStorage.getItem(key)
          if (!raw && dateStr === today) {
            raw = await AsyncStorage.getItem(`daily-draft-${cId}`)
          }
          if (raw) {
            const draft = JSON.parse(raw)
            setDailyValues(draft)
            setDraftRestored(true)
          } else {
            setDraftRestored(false)
          }
        } catch {
          setDraftRestored(false)
        }
      }

      } finally {
        if (cancelled || dayLoadSeq.current !== loadId) return
        if (!firstDayLoaded.current) {
          firstDayLoaded.current = true
          setReady(true)
        }
        setSyncing(false)
      }
    })()
    return () => { cancelled = true }
  }, [bootstrapReady, clientId, trainerId, selectedDate, config?.checkin_day, today])

  // Keep selected day inside allowed window (nutrition parity: max 3 days back, not before signup).
  useEffect(() => {
    if (!bootstrapReady) return
    setSelectedDate(d => {
      if (d < effectiveMin) return effectiveMin
      if (d > today) return today
      return d
    })
  }, [bootstrapReady, effectiveMin, today])

  const dailyDraftKey = clientId ? `daily-draft-${clientId}-${selectedDate}` : null
  const weeklyDraftKey = clientId ? `weekly-draft-${clientId}-${selectedDate}` : null

  // Auto-save weekly check-in draft whenever values change (only while not yet submitted)
  useEffect(() => {
    if (!weeklyDraftKey || checkinSubmitted || Object.keys(checkinValues).length === 0) return
    AsyncStorage.setItem(weeklyDraftKey, JSON.stringify(checkinValues)).catch(() => {})
  }, [checkinValues, weeklyDraftKey, checkinSubmitted])

  const saveDraft = async () => {
    if (!dailyDraftKey) return
    setSavingDraft(true)
    try {
      await AsyncStorage.setItem(dailyDraftKey, JSON.stringify(dailyValues))
      Alert.alert('', t('ci_draft_saved'))
    } catch {
      // draft save is best-effort — don't block the user
    } finally {
      setSavingDraft(false)
    }
  }

  const clearDraft = async () => {
    if (!dailyDraftKey) return
    try { await AsyncStorage.removeItem(dailyDraftKey) } catch {}
  }

  const setDailyValue = (id: string, v: any) => setDailyValues(p => ({ ...p, [id]: v }))
  const setCheckinValue = (id: string, v: any) => setCheckinValues(p => ({ ...p, [id]: v }))

  const pickPhoto = async (position: string) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') { Alert.alert(t('error'), t('ci_err_permission_photos')); return }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, quality: 0.8 })
    if (!result.canceled && result.assets[0]) setPhotos(p => ({ ...p, [position]: result.assets[0].uri }))
  }

  const takePhoto = async (position: string) => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') { Alert.alert(t('error'), t('ci_err_permission_cam')); return }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.8 })
    if (!result.canceled && result.assets[0]) setPhotos(p => ({ ...p, [position]: result.assets[0].uri }))
  }

  const uploadPhoto = async (uri: string, position: string): Promise<string | null> => {
    try {
      const response = await fetch(uri); const blob = await response.blob()
      const arrayBuffer = await new Response(blob).arrayBuffer()
      const uint8Array = new Uint8Array(arrayBuffer)
      const fileName = `${clientId}/${selectedDate}_${position}_${Date.now()}.jpg`
      const { error } = await supabase.storage.from('checkin-images').upload(fileName, uint8Array, { contentType: 'image/jpeg', upsert: true })
      if (error) throw error
      return fileName
    } catch (e) { console.error('Upload error:', e); return null }
  }

  const handleSaveDaily = async () => {
    if (!clientId || !trainerId) return
    // null/undefined/"" are missing; false (boolean "Ne") and 0 are valid answers
    const missing = dailyParams.filter(p => {
      if (!p.required) return false
      const v = dailyValues[p.id]
      return v === undefined || v === null || v === ''
    })
    if (missing.length > 0) { Alert.alert(t('error'), `${t('required_fields')}: ${missing.map(p => p.name).join(', ')}`); return }
    setSavingDaily(true)
    const dateStr = selectedDate
    try {
      if (existingDailyLog) {
        const { error } = await supabase.from('daily_logs').update({ values: dailyValues }).eq('id', existingDailyLog.id)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('daily_logs').insert({ client_id: clientId, trainer_id: trainerId, date: dateStr, values: dailyValues }).select().single()
        if (error) throw error
        if (data) setExistingDailyLog(data)
      }
      setDailySubmitted(true)
      setDraftRestored(false)
      await clearDraft()
      if (dateStr === today) {
        try { await AsyncStorage.removeItem(`daily-draft-${clientId}`) } catch {}
      }
    } catch {
      Alert.alert(t('error'), t('ci_err_save'))
    } finally {
      setSavingDaily(false)
    }
  }

  const handleSubmitCheckin = async () => {
    if (!clientId || !trainerId) return
    // null/undefined/"" are missing; false (boolean "Ne") and 0 are valid answers
    const missing = weeklyParams.filter(p => {
      if (!p.required) return false
      const v = checkinValues[p.id]
      return v === undefined || v === null || v === ''
    })
    if (missing.length > 0) { Alert.alert(t('error'), `${t('required_fields')}: ${missing.map(p => p.name).join(', ')}`); return }
    setSavingCheckin(true)
    const dateStr = selectedDate
    try {
      const uploadedUrls: Record<string, string> = {}
      let uploadFailed = false
      for (const [position, uri] of Object.entries(photos)) {
        const url = await uploadPhoto(uri, position)
        if (url) uploadedUrls[position] = url
        else uploadFailed = true
      }
      if (uploadFailed) {
        Alert.alert(t('error'), t('ci_err_upload'))
        return
      }
      const newPhotoEntries = Object.entries(uploadedUrls).map(([position, url]) => ({ position, url }))
      // Merge new uploads with existing ones — never wipe photos that were already saved
      const existingPhotoEntries: { position: string; url: string }[] = existingCheckin?.photo_urls ?? []
      const mergedPhotos = [
        ...existingPhotoEntries.filter(e => !newPhotoEntries.find(n => n.position === e.position)),
        ...newPhotoEntries,
      ]
      const payload = {
        client_id: clientId,
        trainer_id: trainerId,
        date: dateStr,
        values: checkinValues,
        photo_urls: mergedPhotos.length > 0 ? mergedPhotos : null,
      }
      if (existingCheckin) {
        const { error } = await supabase.from('checkins').update(payload).eq('id', existingCheckin.id)
        if (error) throw error
      } else {
        const { data: inserted, error } = await supabase.from('checkins').insert(payload).select('id, values, photo_urls, trainer_comment').single()
        if (error) throw error
        // Set existingCheckin so a second submit in the same session does update, not insert
        if (inserted) setExistingCheckin(inserted)
      }
      // Clear the weekly draft now that it's been saved to DB
      if (weeklyDraftKey) AsyncStorage.removeItem(weeklyDraftKey).catch(() => {})
      setCheckinSubmitted(true)
      setShowConfirm(false)
      Alert.alert(t('ci_sent_alert'), t('ci_sent_alert_msg'))
    } catch {
      Alert.alert(t('error'), t('ci_err_save'))
    } finally {
      setSavingCheckin(false)
    }
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
                <Text style={styles.unitText} numberOfLines={1} adjustsFontSizeToFit>{param.unit}</Text>
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

  const [sy, sm, sd] = selectedDate.split('-').map(Number)
  const selectedDayOfWeek = new Date(sy, sm - 1, sd).getDay()
  const isCheckinDay = config?.checkin_day === selectedDayOfWeek
  const needsPhotos = shouldSendPhotos(config?.photo_frequency || null, lastCheckinDate, selectedDate)
  const photoPositions: string[] = config?.photo_positions || []

  const dayCommentText = existingCheckin?.trainer_comment?.trim() ?? ''
  const trainerCommentBody = dayCommentText || latestTrainerComment?.comment?.trim() || ''
  const trainerCommentLabelDate = dayCommentText
    ? selectedDate
    : (latestTrainerComment?.date ?? selectedDate)
  const hasWeeklyShell = weeklyParams.length > 0 || photoPositions.length > 0

  if (!ready && ctxClient?.clientId) {
    return <View style={styles.loadingContainer}><ActivityIndicator size="large" color="#f59e0b" /></View>
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">

        {/* Header */}
        <View style={[styles.headerBg, { paddingTop: insets.top + 12 }]}>
          <View style={styles.headerTopRow}>
            <Text style={styles.headerLabel}>Check-in</Text>
            <TouchableOpacity
              onPress={() => router.push('/checkin-history')}
              style={styles.historyBtn}
              activeOpacity={0.75}
            >
              {/* Split emoji + text — Android drops text after emoji in fontWeight:'600' */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text>📊</Text>
                <Text style={styles.historyBtnText}>{t('ci_progress_label')}</Text>
              </View>
            </TouchableOpacity>
          </View>
          <Text style={styles.headerTitle}>
            {new Date(`${selectedDate}T12:00:00`).toLocaleDateString(locale, { weekday: 'long', day: '2-digit', month: 'long' })}
          </Text>
          <View style={styles.dateNav}>
            <TouchableOpacity
              style={[styles.dateNavBtn, !canGoBack && styles.dateNavBtnDisabled]}
              onPress={() => { if (canGoBack) setSelectedDate(offsetDate(selectedDate, -1)) }}
              disabled={!canGoBack}
            >
              <Text style={[styles.dateNavArrow, !canGoBack && { opacity: 0.3 }]}>‹</Text>
            </TouchableOpacity>
            <View style={{ flex: 1, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
              {syncing && <ActivityIndicator size="small" color="white" />}
              <Text style={styles.dateNavLabel}>{fmtSelectedDate(selectedDate)}</Text>
            </View>
            <TouchableOpacity
              style={[styles.dateNavBtn, !canGoForward && styles.dateNavBtnDisabled]}
              onPress={() => { if (canGoForward) setSelectedDate(offsetDate(selectedDate, 1)) }}
              disabled={!canGoForward}
            >
              <Text style={[styles.dateNavArrow, !canGoForward && { opacity: 0.3 }]}>›</Text>
            </TouchableOpacity>
          </View>
          {config && (
            <Text style={styles.headerMeta}>
              {t('ci_weekly_title')}: {config.checkin_day !== null ? DAYS[config.checkin_day] : t('none')}
            </Text>
          )}
        </View>

        {/* Late check-in warning — only when viewing today */}
        {selectedDate === today && isLate && !checkinSubmitted && (
          <View style={styles.lateCard}>
            <Text style={styles.lateIcon}>⚠️</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.lateTitle}>{t('ci_late_title')}</Text>
              <Text style={styles.lateSub}>{t('ci_late_sub')}</Text>
            </View>
          </View>
        )}

        {/* ── DNEVNI UNOS ─────────────────────────────────────────── */}
        {dailyParams.length > 0 && (
          <View style={styles.block}>
            <View style={styles.blockHeader}>
              <View style={[styles.blockDot, { backgroundColor: '#f59e0b' }]} />
              <Text style={styles.blockTitle}>{t('ci_daily_title')}</Text>
              {dailySubmitted && <View style={styles.pill}><Text style={styles.pillText}>{t('ci_done_today')}</Text></View>}
            </View>

            {/* Draft restored banner */}
            {draftRestored && !dailySubmitted && (
              <View style={styles.draftBanner}>
                <Text style={styles.draftBannerText}>↻  {t('ci_draft_restored')}</Text>
              </View>
            )}

            <View style={styles.numberList}>
              {dailyParams.filter(p => p.type === 'number').map(p => renderParam(p, dailyValues, setDailyValue))}
            </View>
            {dailyParams.filter(p => p.type !== 'number').map(p => renderParam(p, dailyValues, setDailyValue))}

            {dailySubmitted ? (
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: '#9ca3af' }]}
                onPress={handleSaveDaily}
                disabled={savingDaily}
              >
                <Text style={styles.btnText}>
                  {savingDaily ? t('ci_saving') : `↺  ${t('update')}`}
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.draftSubmitRow}>
                <TouchableOpacity
                  style={[styles.draftBtn, savingDraft && { opacity: 0.6 }]}
                  onPress={saveDraft}
                  disabled={savingDraft}
                >
                  <Text style={styles.draftBtnText}>
                    {savingDraft ? '...' : t('ci_draft_btn')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.submitBtn, { backgroundColor: '#f59e0b' }, savingDaily && { opacity: 0.6 }]}
                  onPress={handleSaveDaily}
                  disabled={savingDaily}
                >
                  <Text style={styles.btnText}>
                    {savingDaily ? t('ci_saving') : t('ci_daily_send_btn')}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* Komentar trenera (samo tekst) kad nema tjednog bloka — inače je unutar tjednog, iznad fotografija */}
        {!!trainerCommentBody && !hasWeeklyShell && (
          <View style={styles.block}>
            <View style={styles.recentCommentCard}>
              <View style={styles.recentCommentHeader}>
                <Text style={styles.recentCommentLabel}>{t('ci_trainer_comment')}</Text>
                <Text style={styles.recentCommentDate}>
                  {fmtSelectedDate(trainerCommentLabelDate)}
                </Text>
              </View>
              <Text style={styles.recentCommentText}>{trainerCommentBody}</Text>
            </View>
          </View>
        )}

        {/* ── DIVIDER ─────────────────────────────────────────────── */}
        {dailyParams.length > 0 && hasWeeklyShell && (
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerLabel}>{t('ci_weekly_title').toLowerCase()}</Text>
            <View style={styles.dividerLine} />
          </View>
        )}

        {/* ── TJEDNI CHECK-IN ──────────────────────────────────────── */}
        {hasWeeklyShell && (
          <View style={styles.block}>
            <View style={styles.blockHeader}>
              <View style={[styles.blockDot, { backgroundColor: '#78350f' }]} />
              <Text style={styles.blockTitle}>{t('ci_weekly_title')}</Text>
              <View style={[styles.pill, isCheckinDay ? styles.pillBlue : styles.pillGray]}>
                <Text style={[styles.pillText, isCheckinDay && { color: '#1d4ed8' }]}>
                  {isCheckinDay ? t('today') : config?.checkin_day !== null ? DAYS[config!.checkin_day!] : ''}
                </Text>
              </View>
            </View>

            {checkinSubmitted && (
              <View style={styles.submittedRow}>
                <View style={styles.submittedCheck}><Text style={styles.submittedCheckText}>✓</Text></View>
                <View>
                  <Text style={styles.submittedTitle}>{t('ci_send_btn').replace('✓  ', '')}</Text>
                  <Text style={styles.submittedSub}>{t('ci_checkin_confirm_msg').split('.')[0]}</Text>
                </View>
              </View>
            )}

            <View style={styles.numberList}>
              {weeklyParams.filter(p => p.type === 'number').map(p => renderParam(p, checkinValues, setCheckinValue))}
            </View>
            {weeklyParams.filter(p => p.type !== 'number').map(p => renderParam(p, checkinValues, setCheckinValue))}

            {!!trainerCommentBody && (
              <View style={styles.recentCommentCard}>
                <View style={styles.recentCommentHeader}>
                  <Text style={styles.recentCommentLabel}>{t('ci_trainer_comment')}</Text>
                  <Text style={styles.recentCommentDate}>
                    {fmtSelectedDate(trainerCommentLabelDate)}
                  </Text>
                </View>
                <Text style={styles.recentCommentText}>{trainerCommentBody}</Text>
              </View>
            )}

            {/* Fotografije */}
            {needsPhotos && photoPositions.length > 0 && (
              <View style={styles.photosWrap}>
                <Text style={styles.photosTitle}>{t('ci_photos_title')}</Text>
                <View style={styles.photosGrid}>
                  {photoPositions.map(position => {
                    const existingUrl = resolvedExistingUrls[position] || (existingCheckin?.photo_urls as any[])?.find((p: any) => p.position === position)?.url
                    const displayUri = photos[position] || existingUrl
                    const posLabel = position === 'front' ? t('ci_photo_front')
                      : position === 'back'  ? t('ci_photo_back')
                      : position === 'side'  ? t('ci_photo_side')
                      : position
                    return (
                      <View key={position} style={styles.photoCard}>
                        <Text style={styles.photoLabel}>{posLabel}</Text>
                        {displayUri ? (
                          <TouchableOpacity onPress={() => Alert.alert(posLabel, t('ci_photo_select'), [
                            { text: t('ci_photo_gallery'), onPress: () => pickPhoto(position) },
                            { text: t('ci_photo_camera'), onPress: () => takePhoto(position) },
                            { text: t('ci_photo_cancel'), style: 'cancel' },
                          ])}>
                            <Image source={{ uri: displayUri }} style={styles.photoImg} />
                            <Text style={styles.photoChangeText}>{t('ci_photo_change')}</Text>
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity style={styles.photoEmpty} onPress={() => Alert.alert(posLabel, t('ci_photo_select'), [
                            { text: t('ci_photo_gallery'), onPress: () => pickPhoto(position) },
                            { text: t('ci_photo_camera'), onPress: () => takePhoto(position) },
                            { text: t('ci_photo_cancel'), style: 'cancel' },
                          ])}>
                            <Text style={styles.photoEmptyText}>{t('ci_photo_add')}</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )
                  })}
                </View>
              </View>
            )}

            {checkinSubmitted ? (
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: '#9ca3af' }]}
                onPress={() => setShowConfirm(true)}
                disabled={savingCheckin}
              >
                <Text style={styles.btnText}>
                  {savingCheckin ? t('ci_sending') : t('ci_update_btn')}
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: '#78350f' }, savingCheckin && { opacity: 0.6 }]}
                onPress={() => setShowConfirm(true)}
                disabled={savingCheckin}
              >
                <Text style={styles.btnText}>
                  {savingCheckin ? t('ci_sending') : t('ci_send_btn')}
                </Text>
              </TouchableOpacity>
            )}
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
    backgroundColor: '#78350f', paddingHorizontal: 20,
    paddingBottom: 24, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, marginBottom: 8,
  },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  headerLabel: { fontSize: 12, color: '#fcd34d', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  historyBtn: {
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 99,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  historyBtnText: { fontSize: 12, color: 'white', fontWeight: '600' },
  headerTitle: { fontSize: 22, fontWeight: '800', color: 'white', marginBottom: 8, textTransform: 'capitalize' },
  dateNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 12,
    paddingHorizontal: 4, paddingVertical: 4, marginTop: 4, marginBottom: 8,
  },
  dateNavBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  dateNavBtnDisabled: { opacity: 0.3 },
  dateNavArrow: { fontSize: 22, color: 'white', fontWeight: '300' },
  dateNavLabel: { fontSize: 14, fontWeight: '700', color: 'white', textAlign: 'center' },
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
    borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, overflow: 'hidden',
  },
  numberInput: {
    width: 62, paddingHorizontal: 8, paddingVertical: 8,
    fontSize: 17, fontWeight: '700', color: '#111827', textAlign: 'center',
  },
  unitBox: {
    minWidth: 44, maxWidth: 70, backgroundColor: '#f9fafb', borderLeftWidth: 1, borderLeftColor: '#e5e7eb',
    paddingHorizontal: 8, paddingVertical: 8, justifyContent: 'center', alignItems: 'center',
  },
  unitText: { fontSize: 11, fontWeight: '600', color: '#9ca3af' },

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

  lateCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    marginHorizontal: 16, marginTop: 12,
    backgroundColor: '#fff7ed', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#fed7aa',
  },
  lateIcon: { fontSize: 18, marginTop: 1 },
  lateTitle: { fontSize: 14, fontWeight: '700', color: '#c2410c', marginBottom: 2 },
  lateSub: { fontSize: 12, color: '#ea580c', lineHeight: 17 },

  recentCommentCard: {
    marginHorizontal: 0, marginTop: 4, marginBottom: 12,
    backgroundColor: '#eff6ff', borderRadius: 14, padding: 14,
    borderLeftWidth: 3, borderLeftColor: '#3b82f6',
  },
  recentCommentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  recentCommentLabel: { fontSize: 12, fontWeight: '700', color: '#1d4ed8', textTransform: 'uppercase', letterSpacing: 0.5 },
  recentCommentDate: { fontSize: 11, color: '#93c5fd', fontWeight: '600' },
  recentCommentText: { fontSize: 14, color: '#1e40af', lineHeight: 20 },
  draftBanner: {
    backgroundColor: '#fefce8', borderRadius: 12, padding: 10, marginBottom: 12,
    borderWidth: 1, borderColor: '#fde68a',
  },
  draftBannerText: { fontSize: 12, color: '#92400e', fontWeight: '600' },
  draftSubmitRow: { flexDirection: 'row', gap: 10 },
  draftBtn: {
    flex: 1, backgroundColor: '#f3f4f6', borderRadius: 14, paddingVertical: 15,
    alignItems: 'center', borderWidth: 1.5, borderColor: '#d1d5db',
  },
  draftBtnText: { fontSize: 14, fontWeight: '700', color: '#6b7280' },
  submitBtn: {
    flex: 2, backgroundColor: '#78350f', borderRadius: 14, paddingVertical: 15,
    alignItems: 'center',
  },
  submittedRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#f0fdf4', borderRadius: 14, marginBottom: 10, padding: 14, borderWidth: 1, borderColor: '#86efac' },
  submittedCheck: { width: 32, height: 32, borderRadius: 99, backgroundColor: '#22c55e', alignItems: 'center', justifyContent: 'center' },
  submittedCheckText: { color: 'white', fontSize: 16, fontWeight: '700' },
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
