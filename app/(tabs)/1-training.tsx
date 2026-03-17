import { supabase } from '@/lib/supabase'
import { useLanguage } from '@/lib/LanguageContext'
import { useNavigation, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator, Alert, Animated, KeyboardAvoidingView, Linking, Modal,
  Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View
} from 'react-native'

type PlanExercise = {
  exercise_id: string
  name: string
  sets: number
  reps: string
  rest_seconds: number
  notes: string
  description?: string
  video_url?: string
}

type PlanDay = {
  day_number: number
  name: string
  exercises: PlanExercise[]
}

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

type LastLog = {
  exercise_id: string
  sets: SetLog[]
  date: string
}

type WorkoutPlan = {
  id: string
  name: string
  description: string | null
  days: PlanDay[]
  assigned_at: string
  notes: string | null
  client_id: string
  trainer_id: string
}

const getWeekStart = () => {
  const now = new Date()
  const day = now.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + diff)
  monday.setHours(0, 0, 0, 0)
  return monday.toISOString().split('T')[0]
}

const getWeekEnd = () => {
  const start = new Date(getWeekStart())
  const sunday = new Date(start)
  sunday.setDate(start.getDate() + 6)
  return sunday.toISOString().split('T')[0]
}

// ── Rest Timer ────────────────────────────────────────────────────────────────
function RestTimer({ seconds, onDone }: { seconds: number; onDone: () => void }) {
  const { t } = useLanguage()
  const [remaining, setRemaining] = useState(seconds)
  const progress = useRef(new Animated.Value(1)).current

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 0,
      duration: seconds * 1000,
      useNativeDriver: false,
    }).start()

    const interval = setInterval(() => {
      setRemaining(r => {
        if (r <= 1) { clearInterval(interval); onDone(); return 0 }
        return r - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const barWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] })

  return (
    <View style={timerStyles.container}>
      <Text style={timerStyles.label}>{t('train_rest_label')}</Text>
      <Text style={timerStyles.countdown}>{remaining}s</Text>
      <View style={timerStyles.bar}>
        <Animated.View style={[timerStyles.fill, { width: barWidth }]} />
      </View>
      <TouchableOpacity onPress={onDone} style={timerStyles.skipBtn}>
        <Text style={timerStyles.skipText}>{t('skip')}</Text>
      </TouchableOpacity>
    </View>
  )
}

const timerStyles = StyleSheet.create({
  container: {
    position: 'absolute', bottom: 88, left: 16, right: 16,
    backgroundColor: '#1e3a5f', borderRadius: 16, padding: 16,
    alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 12, elevation: 8, zIndex: 100,
  },
  label: { fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  countdown: { fontSize: 36, fontWeight: '800', color: 'white', marginBottom: 10 },
  bar: { width: '100%', height: 4, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 99, overflow: 'hidden', marginBottom: 10 },
  fill: { height: '100%', backgroundColor: '#22c55e', borderRadius: 99 },
  skipBtn: { paddingHorizontal: 20, paddingVertical: 6 },
  skipText: { fontSize: 13, color: 'rgba(255,255,255,0.5)', fontWeight: '600' },
})

// ── Exercise Detail Modal ─────────────────────────────────────────────────────
function ExerciseDetailModal({ exercise, onClose }: { exercise: PlanExercise; onClose: () => void }) {
  const { t } = useLanguage()
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={detailStyles.container}>
        <View style={detailStyles.header}>
          <Text style={detailStyles.title}>{exercise.name}</Text>
          <TouchableOpacity onPress={onClose} style={detailStyles.closeBtn}>
            <Text style={detailStyles.closeText}>{t('train_detail_close')}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={detailStyles.scroll} contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>
          <View style={detailStyles.pill}>
            <Text style={detailStyles.pillText}>
              {exercise.sets} {t('per_sets')} × {exercise.reps} {t('per_reps')}
              {exercise.rest_seconds ? `  ·  ${exercise.rest_seconds}s ${t('rest')}` : ''}
            </Text>
          </View>

          {exercise.description ? (
            <View style={detailStyles.section}>
              <Text style={detailStyles.sectionLabel}>{t('train_detail_desc')}</Text>
              <Text style={detailStyles.sectionText}>{exercise.description}</Text>
            </View>
          ) : null}

          {exercise.notes ? (
            <View style={detailStyles.section}>
              <Text style={detailStyles.sectionLabel}>{t('train_detail_note')}</Text>
              <View style={detailStyles.noteBox}>
                <Text style={detailStyles.noteText}>{exercise.notes}</Text>
              </View>
            </View>
          ) : null}

          {exercise.video_url ? (
            <View style={detailStyles.section}>
              <Text style={detailStyles.sectionLabel}>{t('train_detail_video')}</Text>
              <TouchableOpacity style={detailStyles.videoBtn}
                onPress={() => exercise.video_url && Linking.openURL(exercise.video_url)}>
                <Text style={detailStyles.videoBtnText}>{t('train_detail_video_btn')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  )
}

const detailStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  header: {
    backgroundColor: '#1e3a5f', paddingTop: 24, paddingHorizontal: 20, paddingBottom: 20,
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
  },
  title: { fontSize: 22, fontWeight: '800', color: 'white', flex: 1, marginRight: 16 },
  closeBtn: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 99, paddingHorizontal: 14, paddingVertical: 7 },
  closeText: { color: 'white', fontSize: 14, fontWeight: '600' },
  scroll: { flex: 1 },
  pill: { backgroundColor: '#eff6ff', borderRadius: 99, alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 7, marginBottom: 20 },
  pillText: { fontSize: 13, fontWeight: '600', color: '#3b82f6' },
  section: { marginBottom: 20 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
  sectionText: { fontSize: 15, color: '#374151', lineHeight: 22 },
  noteBox: { backgroundColor: '#fffbeb', borderRadius: 12, padding: 14, borderLeftWidth: 3, borderLeftColor: '#f59e0b' },
  noteText: { fontSize: 14, color: '#78350f', lineHeight: 20 },
  videoBtn: { backgroundColor: '#3b82f6', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  videoBtnText: { color: 'white', fontSize: 15, fontWeight: '700' },
})

// ── Finish Confirm Modal ──────────────────────────────────────────────────────
function FinishModal({
  exerciseLogs,
  allCompleted,
  onConfirm,
  onCancel,
}: {
  exerciseLogs: ExerciseLog[]
  allCompleted: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useLanguage()
  const incomplete = exerciseLogs.flatMap(ex =>
    ex.sets.filter(s => !s.completed).map(s => ({ name: ex.name, set: s.set_number }))
  )

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onCancel}>
      <View style={finishStyles.overlay}>
        <View style={finishStyles.card}>
          <Text style={finishStyles.title}>{t('train_session_finish')}</Text>

          {incomplete.length > 0 ? (
            <>
              <View style={finishStyles.warningBox}>
                <Text style={finishStyles.warningTitle}>{t('train_session_incomplete_title')}</Text>
                {incomplete.slice(0, 4).map((item, i) => (
                  <Text key={i} style={finishStyles.warningItem}>
                    · {item.name} – {t('per_sets')} {item.set}
                  </Text>
                ))}
                {incomplete.length > 4 && (
                  <Text style={finishStyles.warningItem}>· i još {incomplete.length - 4}...</Text>
                )}
              </View>
              <Text style={finishStyles.sub}>{t('train_session_incomplete_sub')}</Text>
            </>
          ) : (
            <Text style={finishStyles.sub}>{t('train_session_all_done')}</Text>
          )}

          <View style={finishStyles.btns}>
            <TouchableOpacity onPress={onCancel} style={finishStyles.cancelBtn}>
              <Text style={finishStyles.cancelText}>{t('train_session_continue')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onConfirm} style={finishStyles.confirmBtn}>
              <Text style={finishStyles.confirmText}>{t('train_session_save')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const finishStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { backgroundColor: 'white', borderRadius: 20, padding: 24, width: '100%' },
  title: { fontSize: 20, fontWeight: '800', color: '#111827', marginBottom: 16, textAlign: 'center' },
  warningBox: { backgroundColor: '#fff7ed', borderRadius: 12, padding: 14, marginBottom: 12, borderLeftWidth: 3, borderLeftColor: '#f97316' },
  warningTitle: { fontSize: 13, fontWeight: '700', color: '#92400e', marginBottom: 8 },
  warningItem: { fontSize: 13, color: '#78350f', marginBottom: 2 },
  sub: { fontSize: 14, color: '#6b7280', textAlign: 'center', marginBottom: 20, lineHeight: 20 },
  btns: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, backgroundColor: '#f3f4f6', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontSize: 15, fontWeight: '600', color: '#374151' },
  confirmBtn: { flex: 1, backgroundColor: '#22c55e', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  confirmText: { fontSize: 15, fontWeight: '700', color: 'white' },
})

// ── Update Confirm Modal ──────────────────────────────────────────────────────
function UpdateModal({
  exerciseLogs,
  onConfirm,
  onCancel,
}: {
  exerciseLogs: ExerciseLog[]
  onConfirm: (logs: ExerciseLog[]) => void
  onCancel: () => void
}) {
  const { t } = useLanguage()
  const [logs, setLogs] = useState<ExerciseLog[]>(exerciseLogs.map(ex => ({
    ...ex,
    sets: ex.sets.map(s => ({ ...s }))
  })))

  const updateSet = (exId: string, setIdx: number, field: 'reps' | 'weight', value: string) => {
    setLogs(prev => prev.map(ex =>
      ex.exercise_id === exId
        ? { ...ex, sets: ex.sets.map((s, i) => i === setIdx ? { ...s, [field]: value } : s) }
        : ex
    ))
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: '#f3f4f6' }}>
        <View style={[detailStyles.header, { flexDirection: 'column', alignItems: 'flex-start', gap: 8 }]}>
          <TouchableOpacity onPress={onCancel} style={detailStyles.closeBtn}>
            <Text style={detailStyles.closeText}>{t('train_cancel_update')}</Text>
          </TouchableOpacity>
          <Text style={[detailStyles.title, { marginRight: 0 }]}>{t('train_update_title')}</Text>
          <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>{t('train_update_sub')}</Text>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
          {logs.map((ex, exIdx) => (
            <View key={`${ex.exercise_id ?? 'ex'}-${exIdx}`} style={[styles.exerciseCard, { marginHorizontal: 0 }]}>
              <Text style={styles.exerciseCardName}>{ex.name}</Text>
              <View style={[styles.setsHeader, { marginTop: 10 }]}>
                <Text style={[styles.setsCol, { flex: 0.5 }]}>#</Text>
                <Text style={[styles.setsCol, { flex: 1 }]}>{t('train_kg')}</Text>
                <Text style={[styles.setsCol, { flex: 1 }]}>{t('train_reps')}</Text>
              </View>
              {ex.sets.map((set, i) => (
                <View key={i} style={[styles.setRow, { marginBottom: 6 }]}>
                  <Text style={[styles.setsCol, { flex: 0.5, fontWeight: '700', color: '#6b7280', textAlign: 'center' }]}>{i + 1}</Text>
                  <TextInput
                    style={[styles.setInput, { flex: 1 }]}
                    value={set.weight}
                    onChangeText={v => updateSet(ex.exercise_id, i, 'weight', v)}
                    keyboardType="decimal-pad"
                  />
                  <TextInput
                    style={[styles.setInput, { flex: 1 }]}
                    value={set.reps}
                    onChangeText={v => updateSet(ex.exercise_id, i, 'reps', v)}
                    keyboardType="number-pad"
                  />
                </View>
              ))}
            </View>
          ))}
        </ScrollView>

        <View style={styles.saveBar}>
          <TouchableOpacity style={[styles.saveBtn, { backgroundColor: '#f59e0b' }]} onPress={() => onConfirm(logs)}>
            <Text style={styles.saveBtnText}>{t('train_save_updated')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function TrainingScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const { t, lang } = useLanguage()
  const locale = lang === 'en' ? 'en' : 'hr'
  const [plan, setPlan] = useState<WorkoutPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeDay, setActiveDay] = useState<PlanDay | null>(null)
  const [exerciseLogs, setExerciseLogs] = useState<ExerciseLog[]>([])
  const [lastLogs, setLastLogs] = useState<Record<string, LastLog>>({})
  const [completedThisWeek, setCompletedThisWeek] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Timer
  const [restTimer, setRestTimer] = useState<{ exerciseId: string; seconds: number } | null>(null)
  // Detail modal
  const [detailExercise, setDetailExercise] = useState<PlanExercise | null>(null)
  // Finish confirm
  const [showFinish, setShowFinish] = useState(false)
  // Update modal (post-save edit)
  const [showUpdate, setShowUpdate] = useState(false)
  const [savedLogs, setSavedLogs] = useState<ExerciseLog[]>([])
  const [existingLogId, setExistingLogId] = useState<string | null>(null)

  useEffect(() => { fetchPlan() }, [])

  // Tap on the training tab when already on it → go back to plan overview
  useEffect(() => {
    const unsub = (navigation as any).addListener('tabPress', () => {
      if (activeDay) {
        setActiveDay(null)
        setExerciseLogs([])
        setSaved(false)
        setShowFinish(false)
        setExistingLogId(null)
      }
    })
    return unsub
  }, [navigation, activeDay])

  const fetchPlan = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: clientData } = await supabase
      .from('clients').select('id, trainer_id').eq('user_id', user.id).single()
    if (!clientData) return setLoading(false)

    const { data: assigned } = await supabase
      .from('client_workout_plans')
      .select('workout_plan_id, assigned_at, notes')
      .eq('client_id', clientData.id)
      .eq('active', true)
      .order('assigned_at', { ascending: false })
      .limit(1)
      .single()

    if (!assigned) return setLoading(false)

    const { data: planData } = await supabase
      .from('workout_plans').select('id, name, description, days')
      .eq('id', assigned.workout_plan_id).single()

    if (!planData) return setLoading(false)

    const { data: weekLogs } = await supabase
      .from('workout_logs').select('day_name, date')
      .eq('client_id', clientData.id).eq('plan_id', planData.id)
      .gte('date', getWeekStart()).lte('date', getWeekEnd())

    setCompletedThisWeek(weekLogs?.map(l => l.day_name) || [])
    setPlan({
      id: planData.id, name: planData.name, description: planData.description,
      days: planData.days || [], assigned_at: assigned.assigned_at,
      notes: assigned.notes, client_id: clientData.id, trainer_id: clientData.trainer_id,
    })
    setLoading(false)
  }

  const openDay = async (day: PlanDay) => {
    setSaved(false)
    setExistingLogId(null)

    if (!plan) return

    // Fetch fresh description + video_url directly from exercises table
    // (plan.days JSONB only stores exercise_id, not description/video_url)
    const exerciseIds = day.exercises.map(e => e.exercise_id).filter(Boolean)
    let freshDetails: Record<string, { description?: string; video_url?: string }> = {}
    if (exerciseIds.length > 0) {
      const { data: exData } = await supabase
        .from('exercises')
        .select('id, description, video_url')
        .in('id', exerciseIds)
      exData?.forEach(e => { freshDetails[e.id] = { description: e.description || undefined, video_url: e.video_url || undefined } })
    }

    const enrichedDay: PlanDay = {
      ...day,
      exercises: day.exercises.map(ex => ({
        ...ex,
        description: freshDetails[ex.exercise_id]?.description,
        video_url: freshDetails[ex.exercise_id]?.video_url,
      }))
    }

    setActiveDay(enrichedDay)

    const logs: ExerciseLog[] = enrichedDay.exercises.map(ex => ({
      exercise_id: ex.exercise_id,
      name: ex.name,
      sets: Array.from({ length: ex.sets }, (_, i) => ({
        set_number: i + 1, reps: '', weight: '', completed: false,
      }))
    }))
    setExerciseLogs(logs)

    const { data: prevLogs } = await supabase
      .from('workout_logs').select('id, exercises, date')
      .eq('client_id', plan.client_id).eq('plan_id', plan.id).eq('day_name', day.name)
      .order('date', { ascending: false }).limit(1)

    if (prevLogs && prevLogs.length > 0) {
      const lastMap: Record<string, LastLog> = {}
      const prevExercises: ExerciseLog[] = prevLogs[0].exercises || []
      prevExercises.forEach(ex => {
        lastMap[ex.exercise_id] = { exercise_id: ex.exercise_id, sets: ex.sets, date: prevLogs[0].date }
      })
      setLastLogs(lastMap)

      // If today's log exists, store its id for potential update
      if (prevLogs[0].date === new Date().toISOString().split('T')[0]) {
        setExistingLogId(prevLogs[0].id)
        setSavedLogs(prevExercises)
      }
    } else {
      setLastLogs({})
    }
  }

  const updateSet = (exerciseId: string, setIndex: number, field: 'reps' | 'weight', value: string) => {
    setExerciseLogs(prev => prev.map(ex =>
      ex.exercise_id === exerciseId
        ? { ...ex, sets: ex.sets.map((s, i) => i === setIndex ? { ...s, [field]: value } : s) }
        : ex
    ))
  }

  const toggleSet = (exerciseId: string, setIndex: number) => {
    setExerciseLogs(prev => prev.map(ex => {
      if (ex.exercise_id !== exerciseId) return ex
      const updated = ex.sets.map((s, i) => i === setIndex ? { ...s, completed: !s.completed } : s)
      const justCompleted = !ex.sets[setIndex].completed

      // Start rest timer if completing a set
      if (justCompleted) {
        const planEx = activeDay?.exercises.find(e => e.exercise_id === exerciseId)
        if (planEx?.rest_seconds) {
          setRestTimer({ exerciseId, seconds: planEx.rest_seconds })
        }
      }

      return { ...ex, sets: updated }
    }))
  }

  const saveWorkout = async () => {
    if (!plan || !activeDay) return
    setSaving(true)

    const today = new Date().toISOString().split('T')[0]

    // If a log already exists today — update it instead of inserting
    if (existingLogId) {
      await supabase.from('workout_logs').update({ exercises: exerciseLogs }).eq('id', existingLogId)
    } else {
      const { error } = await supabase.from('workout_logs').insert({
        client_id: plan.client_id, trainer_id: plan.trainer_id,
        plan_id: plan.id, day_name: activeDay.name,
        date: today, exercises: exerciseLogs,
      })
      if (error) {
        Alert.alert('Greška', error.message)
        setSaving(false)
        return
      }
    }

    setSaved(true)
    setSavedLogs(exerciseLogs)
    setCompletedThisWeek(prev =>
      prev.includes(activeDay.name) ? prev : [...prev, activeDay.name]
    )
    setSaving(false)
  }

  const handleUpdateConfirm = async (updatedLogs: ExerciseLog[]) => {
    if (!existingLogId) return
    await supabase.from('workout_logs').update({ exercises: updatedLogs }).eq('id', existingLogId)
    setSavedLogs(updatedLogs)
    setShowUpdate(false)
  }

  const getNextDay = () => {
    if (!plan) return null
    return plan.days.filter(d => !completedThisWeek.includes(d.name))[0] || null
  }

  if (loading) return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color="#3b82f6" />
    </View>
  )

  if (!plan) return (
    <View style={styles.emptyContainer}>
      <Text style={{ fontSize: 28, marginBottom: 10 }}>🏋️</Text>
      <Text style={styles.emptyTitle}>{t('train_empty_title')}</Text>
      <Text style={styles.emptySub}>{t('train_empty_sub')}</Text>
    </View>
  )

  // ── Active workout session ──
  if (activeDay) {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={styles.sessionHeader}>
          <TouchableOpacity onPress={() => setActiveDay(null)} style={styles.backBtn}>
            <View style={styles.backBtnInner}>
              <Text style={styles.backBtnArrow}>‹</Text>
              <Text style={styles.backBtnText}>{t('back')}</Text>
            </View>
          </TouchableOpacity>
          <Text style={styles.sessionTitle}>{activeDay.name}</Text>
          <Text style={styles.sessionDate}>
            {new Date().toLocaleDateString(locale, { day: '2-digit', month: 'long' })}
          </Text>
        </View>

        <ScrollView
          style={styles.sessionScroll}
          contentContainerStyle={{ paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {activeDay.exercises.map((ex, exIndex) => {
            const log = exerciseLogs.find(l => l.exercise_id === ex.exercise_id)
            const last = lastLogs[ex.exercise_id]

            return (
              <View key={`${ex.exercise_id ?? 'ex'}-${exIndex}`} style={styles.exerciseCard}>
                {/* Header — tap for detail */}
                <TouchableOpacity
                  style={styles.exerciseCardHeader}
                  onPress={() => setDetailExercise(ex)}
                  activeOpacity={0.7}
                >
                  <View style={styles.exerciseNumBadge}>
                    <Text style={styles.exerciseNumText}>{exIndex + 1}</Text>
                  </View>
                  <View style={styles.exerciseCardInfo}>
                    <Text style={styles.exerciseCardName}>{ex.name}</Text>
                    <Text style={styles.exerciseCardTarget}>
                      {ex.sets} serije × {ex.reps} ponavljanja
                      {ex.rest_seconds ? ` · ${ex.rest_seconds}s odmor` : ''}
                    </Text>
                  </View>
                  <Text style={styles.infoIcon}>ℹ</Text>
                </TouchableOpacity>

                {last ? (
                  <View style={styles.lastLogRow}>
                    <Text style={styles.lastLogLabel}>
                      {t('train_prev_last')} ({new Date(last.date).toLocaleDateString(locale, { day: '2-digit', month: 'short' })}):
                    </Text>
                    <Text style={styles.lastLogValue}>
                      {last.sets.map(s => `${s.weight || '?'}kg × ${s.reps || '?'}`).join('  |  ')}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.lastLogRow}>
                    <Text style={styles.lastLogLabel}>{t('train_prev_first')}</Text>
                  </View>
                )}

                <View style={styles.setsHeader}>
                  <Text style={[styles.setsCol, { flex: 0.5 }]}>#</Text>
                  <Text style={[styles.setsCol, { flex: 1 }]}>{t('train_kg')}</Text>
                  <Text style={[styles.setsCol, { flex: 1 }]}>{t('train_reps')}</Text>
                  <Text style={[styles.setsCol, { flex: 0.7 }]}>✓</Text>
                </View>

                {log?.sets.map((set, setIndex) => (
                  <View key={setIndex} style={[styles.setRow, set.completed && styles.setRowDone]}>
                    <Text style={[styles.setsCol, { flex: 0.5, fontWeight: '700', color: '#6b7280', textAlign: 'center' }]}>
                      {setIndex + 1}
                    </Text>
                    <TextInput
                      style={[styles.setInput, { flex: 1 }]}
                      value={set.weight}
                      onChangeText={v => updateSet(ex.exercise_id, setIndex, 'weight', v)}
                      placeholder={last?.sets[setIndex]?.weight || '0'}
                      placeholderTextColor="#d1d5db"
                      keyboardType="decimal-pad"
                    />
                    <TextInput
                      style={[styles.setInput, { flex: 1 }]}
                      value={set.reps}
                      onChangeText={v => updateSet(ex.exercise_id, setIndex, 'reps', v)}
                      placeholder={last?.sets[setIndex]?.reps || ex.reps}
                      placeholderTextColor="#d1d5db"
                      keyboardType="number-pad"
                    />
                    <TouchableOpacity
                      style={[styles.setCheck, set.completed && styles.setCheckDone, { flex: 0.7 }]}
                      onPress={() => toggleSet(ex.exercise_id, setIndex)}
                    >
                      <Text style={[styles.setCheckText, set.completed && { color: 'white' }]}>
                        {set.completed ? '✓' : '○'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ))}

                {ex.notes ? <Text style={styles.exerciseNote}>{ex.notes}</Text> : null}
              </View>
            )
          })}
        </ScrollView>

        {/* Rest timer overlay */}
        {restTimer && (
          <RestTimer
            seconds={restTimer.seconds}
            onDone={() => setRestTimer(null)}
          />
        )}

        {/* Save bar */}
        <View style={styles.saveBar}>
          {saved ? (
            <View style={styles.savedBar}>
              <Text style={styles.savedText}>{t('train_saved')}</Text>
              <TouchableOpacity onPress={() => setShowUpdate(true)} style={styles.updateBtn}>
                <Text style={styles.updateBtnText}>{t('train_update_values')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.saveBtn}
              onPress={() => setShowFinish(true)}
              disabled={saving}
            >
              <Text style={styles.saveBtnText}>
                {saving ? t('train_saving') : t('train_finish')}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Modals */}
        {detailExercise && (
          <ExerciseDetailModal exercise={detailExercise} onClose={() => setDetailExercise(null)} />
        )}

        {showFinish && (
          <FinishModal
            exerciseLogs={exerciseLogs}
            allCompleted={exerciseLogs.every(ex => ex.sets.every(s => s.completed))}
            onConfirm={() => { setShowFinish(false); saveWorkout() }}
            onCancel={() => setShowFinish(false)}
          />
        )}

        {showUpdate && (
          <UpdateModal
            exerciseLogs={savedLogs}
            onConfirm={handleUpdateConfirm}
            onCancel={() => setShowUpdate(false)}
          />
        )}
      </KeyboardAvoidingView>
    )
  }

  const nextDay = getNextDay()
  const allDone = plan.days.every(d => completedThisWeek.includes(d.name))

  // ── Plan overview ──
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.headerBg}>
        <View style={styles.headerTopRow}>
          <Text style={styles.headerLabel}>{t('train_active_plan')}</Text>
          <TouchableOpacity
            onPress={() => router.push('/workout-history')}
            style={styles.historyBtn}
            activeOpacity={0.75}
          >
            <Text style={styles.historyBtnText}>{t('train_history')}</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.headerTitle}>{plan.name}</Text>
        {plan.description && <Text style={styles.headerDesc}>{plan.description}</Text>}
        <View style={styles.weekProgress}>
          <View style={styles.weekProgressHeader}>
            <Text style={styles.weekProgressLabel}>{t('train_this_week')}</Text>
            <Text style={styles.weekProgressCount}>{completedThisWeek.length} / {plan.days.length}</Text>
          </View>
          <View style={styles.weekProgressBar}>
            <View style={[styles.weekProgressFill, { width: `${(completedThisWeek.length / plan.days.length) * 100}%` as any }]} />
          </View>
        </View>
      </View>

      {!allDone && nextDay && (
        <TouchableOpacity style={styles.nextDayBanner} onPress={() => openDay(nextDay)} activeOpacity={0.85}>
          <View>
            <Text style={styles.nextDayLabel}>{t('train_next')}</Text>
            <Text style={styles.nextDayName}>{nextDay.name}</Text>
            <Text style={styles.nextDayMeta}>{nextDay.exercises.length} {t('train_exercises')}</Text>
          </View>
          <Text style={styles.nextDayArrow}>▶</Text>
        </TouchableOpacity>
      )}

      {allDone && (
        <View style={styles.allDoneBanner}>
          <Text style={styles.allDoneIcon}>🏆</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.allDoneTitle}>{t('train_done_week')}</Text>
            <Text style={styles.allDoneSub}>{t('train_done_reset')}</Text>
          </View>
        </View>
      )}

      {plan.notes && (
        <View style={styles.notesCard}>
          <Text style={styles.notesLabel}>{t('trainer_note')}</Text>
          <Text style={styles.notesText}>{plan.notes}</Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>{t('train_all')}</Text>

      {plan.days.map((day, dayIdx) => {
        const isDone = completedThisWeek.includes(day.name)
        const isNext = nextDay?.name === day.name
        return (
          <TouchableOpacity
            key={`day-idx-${dayIdx}`}
            style={[styles.dayCard, isDone && styles.dayCardDone, isNext && styles.dayCardNext]}
            onPress={() => openDay(day)}
            activeOpacity={0.85}
          >
            <View style={styles.dayCardLeft}>
              <View style={[styles.dayDot, isDone && styles.dayDotDone, isNext && styles.dayDotNext]} />
              <View>
                <Text style={[styles.dayName, isDone && styles.dayNameDone]}>{day.name}</Text>
                <Text style={styles.dayMeta}>
                  {day.exercises.length} {t('train_exercises')}
                  {isDone ? t('train_done_week_label') : isNext ? t('train_next_label') : ''}
                </Text>
              </View>
            </View>
            {isDone ? <Text style={styles.dayDoneCheck}>✓</Text> : <Text style={styles.dayArrow}>→</Text>}
          </TouchableOpacity>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { paddingBottom: 32 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 8 },
  emptySub: { fontSize: 14, color: '#9ca3af', textAlign: 'center' },
  headerBg: {
    backgroundColor: '#1e3a5f', paddingTop: 60, paddingHorizontal: 20,
    paddingBottom: 24, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, marginBottom: 16,
  },
  headerTopRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 6,
  },
  historyBtn: {
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 99,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  historyBtnText: { fontSize: 12, color: 'white', fontWeight: '600' },
  headerLabel: { fontSize: 12, color: '#93c5fd', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  headerTitle: { fontSize: 26, fontWeight: '800', color: 'white', marginBottom: 4 },
  headerDesc: { fontSize: 14, color: '#93c5fd', marginBottom: 16 },
  weekProgress: { marginTop: 8 },
  weekProgressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  weekProgressLabel: { fontSize: 12, color: 'rgba(255,255,255,0.7)' },
  weekProgressCount: { fontSize: 12, fontWeight: '700', color: 'white' },
  weekProgressBar: { height: 6, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 99, overflow: 'hidden' },
  weekProgressFill: { height: '100%', backgroundColor: '#22c55e', borderRadius: 99 },
  nextDayBanner: {
    backgroundColor: '#3b82f6', borderRadius: 16, marginHorizontal: 20, marginBottom: 12,
    padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  nextDayLabel: { fontSize: 11, color: 'rgba(255,255,255,0.75)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  nextDayName: { fontSize: 18, fontWeight: '800', color: 'white' },
  nextDayMeta: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  nextDayArrow: { fontSize: 22, color: 'white' },
  allDoneBanner: {
    backgroundColor: '#f0fdf4', borderRadius: 16, marginHorizontal: 20, marginBottom: 12,
    padding: 18, borderWidth: 1, borderColor: '#86efac',
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  allDoneIcon: { fontSize: 22 },
  allDoneTitle: { fontSize: 15, fontWeight: '700', color: '#15803d' },
  allDoneSub: { fontSize: 13, color: '#86efac', marginTop: 2 },
  notesCard: {
    backgroundColor: '#fffbeb', borderRadius: 14, padding: 14,
    marginHorizontal: 20, marginBottom: 16, borderLeftWidth: 3, borderLeftColor: '#f59e0b',
  },
  notesLabel: { fontSize: 12, fontWeight: '700', color: '#92400e', marginBottom: 4 },
  notesText: { fontSize: 13, color: '#78350f', lineHeight: 20 },
  sectionTitle: {
    fontSize: 13, fontWeight: '700', color: '#6b7280',
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10, marginHorizontal: 20,
  },
  dayCard: {
    backgroundColor: 'white', borderRadius: 16, marginHorizontal: 20, marginBottom: 10,
    padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  dayCardDone: { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#86efac' },
  dayCardNext: { borderWidth: 1.5, borderColor: '#3b82f6' },
  dayCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dayDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#e5e7eb' },
  dayDotDone: { backgroundColor: '#22c55e' },
  dayDotNext: { backgroundColor: '#3b82f6' },
  dayName: { fontSize: 15, fontWeight: '600', color: '#111827', marginBottom: 2 },
  dayNameDone: { color: '#15803d' },
  dayMeta: { fontSize: 12, color: '#9ca3af' },
  dayArrow: { fontSize: 18, color: '#9ca3af' },
  dayDoneCheck: { fontSize: 18, color: '#22c55e', fontWeight: '700' },
  sessionHeader: {
    backgroundColor: '#1e3a5f', paddingTop: 60, paddingHorizontal: 20, paddingBottom: 20,
  },
  backBtn: { marginBottom: 12, alignSelf: 'flex-start' },
  backBtnInner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, gap: 4,
  },
  backBtnArrow: { fontSize: 24, color: 'white', lineHeight: 26, fontWeight: '300' },
  backBtnText: { color: 'white', fontSize: 15, fontWeight: '600' },
  sessionTitle: { fontSize: 24, fontWeight: '800', color: 'white' },
  sessionDate: { fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 4 },
  sessionScroll: { flex: 1 },
  exerciseCard: {
    backgroundColor: 'white', borderRadius: 16, margin: 16, marginBottom: 0,
    padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  exerciseCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  exerciseNumBadge: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center' },
  exerciseNumText: { fontSize: 13, fontWeight: '700', color: '#3b82f6' },
  exerciseCardInfo: { flex: 1 },
  exerciseCardName: { fontSize: 15, fontWeight: '700', color: '#111827' },
  exerciseCardTarget: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  infoIcon: { fontSize: 18, color: '#d1d5db', paddingHorizontal: 4 },
  lastLogRow: { backgroundColor: '#f8fafc', borderRadius: 8, padding: 8, marginBottom: 12 },
  lastLogLabel: { fontSize: 11, color: '#9ca3af', marginBottom: 2 },
  lastLogValue: { fontSize: 12, fontWeight: '600', color: '#3b82f6' },
  setsHeader: { flexDirection: 'row', paddingHorizontal: 4, marginBottom: 6 },
  setsCol: { fontSize: 11, fontWeight: '600', color: '#9ca3af', textTransform: 'uppercase', textAlign: 'center' },
  setRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 6, paddingHorizontal: 4, borderRadius: 8, marginBottom: 4,
  },
  setRowDone: { backgroundColor: '#f0fdf4' },
  setInput: {
    borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 8, fontSize: 15,
    fontWeight: '600', color: '#111827', textAlign: 'center', backgroundColor: 'white',
  },
  setCheck: { alignItems: 'center', justifyContent: 'center', height: 36, borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb' },
  setCheckDone: { backgroundColor: '#22c55e', borderColor: '#22c55e' },
  setCheckText: { fontSize: 16, color: '#9ca3af' },
  exerciseNote: { fontSize: 12, color: '#9ca3af', marginTop: 8, fontStyle: 'italic' },
  saveBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 16, backgroundColor: 'white', borderTopWidth: 1, borderTopColor: '#f3f4f6',
  },
  savedBar: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  savedText: { flex: 1, fontSize: 15, fontWeight: '700', color: '#15803d' },
  updateBtn: { backgroundColor: '#fef3c7', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  updateBtnText: { fontSize: 13, fontWeight: '600', color: '#92400e' },
  saveBtn: { backgroundColor: '#3b82f6', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  saveBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },
})
