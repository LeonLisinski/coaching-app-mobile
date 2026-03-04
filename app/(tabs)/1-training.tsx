import { supabase } from '@/lib/supabase'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'

type PlanExercise = {
  exercise_id: string
  name: string
  sets: number
  reps: string
  rest_seconds: number
  notes: string
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

export default function TrainingScreen() {
  const [plan, setPlan] = useState<WorkoutPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeDay, setActiveDay] = useState<PlanDay | null>(null)
  const [exerciseLogs, setExerciseLogs] = useState<ExerciseLog[]>([])
  const [lastLogs, setLastLogs] = useState<Record<string, LastLog>>({})
  const [completedThisWeek, setCompletedThisWeek] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => { fetchPlan() }, [])

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
      .from('workout_plans')
      .select('id, name, description, days')
      .eq('id', assigned.workout_plan_id)
      .single()

    if (!planData) return setLoading(false)

    // Dohvati završene treninge ovaj tjedan
    const { data: weekLogs } = await supabase
      .from('workout_logs')
      .select('day_name, date')
      .eq('client_id', clientData.id)
      .eq('plan_id', planData.id)
      .gte('date', getWeekStart())
      .lte('date', getWeekEnd())

    const doneThisWeek = weekLogs?.map(l => l.day_name) || []
    setCompletedThisWeek(doneThisWeek)

    setPlan({
      id: planData.id,
      name: planData.name,
      description: planData.description,
      days: planData.days || [],
      assigned_at: assigned.assigned_at,
      notes: assigned.notes,
      client_id: clientData.id,
      trainer_id: clientData.trainer_id,
    })
    setLoading(false)
  }

  const openDay = async (day: PlanDay) => {
    setActiveDay(day)
    setSaved(false)

    const logs: ExerciseLog[] = day.exercises.map(ex => ({
      exercise_id: ex.exercise_id,
      name: ex.name,
      sets: Array.from({ length: ex.sets }, (_, i) => ({
        set_number: i + 1,
        reps: '',
        weight: '',
        completed: false,
      }))
    }))
    setExerciseLogs(logs)

    if (!plan) return

    const { data: prevLogs } = await supabase
      .from('workout_logs')
      .select('exercises, date')
      .eq('client_id', plan.client_id)
      .eq('plan_id', plan.id)
      .eq('day_name', day.name)
      .order('date', { ascending: false })
      .limit(1)

    if (prevLogs && prevLogs.length > 0) {
      const lastMap: Record<string, LastLog> = {}
      const prevExercises: ExerciseLog[] = prevLogs[0].exercises || []
      prevExercises.forEach(ex => {
        lastMap[ex.exercise_id] = {
          exercise_id: ex.exercise_id,
          sets: ex.sets,
          date: prevLogs[0].date,
        }
      })
      setLastLogs(lastMap)
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
    setExerciseLogs(prev => prev.map(ex =>
      ex.exercise_id === exerciseId
        ? { ...ex, sets: ex.sets.map((s, i) => i === setIndex ? { ...s, completed: !s.completed } : s) }
        : ex
    ))
  }

  const saveWorkout = async () => {
    if (!plan || !activeDay) return
    setSaving(true)

    const { error } = await supabase.from('workout_logs').insert({
      client_id: plan.client_id,
      trainer_id: plan.trainer_id,
      plan_id: plan.id,
      day_name: activeDay.name,
      date: new Date().toISOString().split('T')[0],
      exercises: exerciseLogs,
    })

    if (error) {
      Alert.alert('Greška', error.message)
      setSaving(false)
      return
    }

    setSaved(true)
    setCompletedThisWeek(prev => [...prev, activeDay.name])

    setTimeout(() => {
      setActiveDay(null)
      setSaved(false)
    }, 1800)

    setSaving(false)
  }

  // Koji je sljedeći trening
  const getNextDay = () => {
    if (!plan) return null
    const remaining = plan.days.filter(d => !completedThisWeek.includes(d.name))
    return remaining[0] || null
  }

  if (loading) return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color="#3b82f6" />
    </View>
  )

  if (!plan) return (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyEmoji}>🏋️</Text>
      <Text style={styles.emptyTitle}>Nema aktivnog plana</Text>
      <Text style={styles.emptySub}>Tvoj trener još nije dodijelio plan treninga.</Text>
    </View>
  )

  // Aktivni trening
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
              <Text style={styles.backBtnText}>Natrag</Text>
            </View>
          </TouchableOpacity>
          <Text style={styles.sessionTitle}>{activeDay.name}</Text>
          <Text style={styles.sessionDate}>
            {new Date().toLocaleDateString('hr', { day: '2-digit', month: 'long' })}
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
              <View key={ex.exercise_id} style={styles.exerciseCard}>
                <View style={styles.exerciseCardHeader}>
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
                </View>

                {last ? (
                  <View style={styles.lastLogRow}>
                    <Text style={styles.lastLogLabel}>
                      Prošli put ({new Date(last.date).toLocaleDateString('hr', { day: '2-digit', month: 'short' })}):
                    </Text>
                    <Text style={styles.lastLogValue}>
                      {last.sets.map(s => `${s.weight || '?'}kg × ${s.reps || '?'}`).join('  |  ')}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.lastLogRow}>
                    <Text style={styles.lastLogLabel}>Prošli put: prvi trening 🎉</Text>
                  </View>
                )}

                <View style={styles.setsHeader}>
                  <Text style={[styles.setsCol, { flex: 0.5 }]}>#</Text>
                  <Text style={[styles.setsCol, { flex: 1 }]}>Kg</Text>
                  <Text style={[styles.setsCol, { flex: 1 }]}>Reps</Text>
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

                {ex.notes ? <Text style={styles.exerciseNote}>📝 {ex.notes}</Text> : null}
              </View>
            )
          })}
        </ScrollView>

        <View style={styles.saveBar}>
          <TouchableOpacity
            style={[styles.saveBtn, saved && styles.saveBtnDone]}
            onPress={saveWorkout}
            disabled={saving || saved}
          >
            <Text style={styles.saveBtnText}>
              {saved ? '✓ Trening spremljen!' : saving ? 'Sprema...' : 'Završi trening 💪'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    )
  }

  const nextDay = getNextDay()
  const allDone = plan.days.every(d => completedThisWeek.includes(d.name))

  // Plan overview
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.headerBg}>
        <Text style={styles.headerLabel}>Aktivni plan</Text>
        <Text style={styles.headerTitle}>{plan.name}</Text>
        {plan.description && <Text style={styles.headerDesc}>{plan.description}</Text>}

        {/* Tjedni progress */}
        <View style={styles.weekProgress}>
          <View style={styles.weekProgressHeader}>
            <Text style={styles.weekProgressLabel}>Ovaj tjedan</Text>
            <Text style={styles.weekProgressCount}>
              {completedThisWeek.length} / {plan.days.length}
            </Text>
          </View>
          <View style={styles.weekProgressBar}>
            <View style={[styles.weekProgressFill, {
              width: `${(completedThisWeek.length / plan.days.length) * 100}%` as any
            }]} />
          </View>
        </View>
      </View>

      {/* Sljedeći trening banner */}
      {!allDone && nextDay && (
        <TouchableOpacity style={styles.nextDayBanner} onPress={() => openDay(nextDay)} activeOpacity={0.85}>
          <View>
            <Text style={styles.nextDayLabel}>Sljedeći trening</Text>
            <Text style={styles.nextDayName}>{nextDay.name}</Text>
            <Text style={styles.nextDayMeta}>{nextDay.exercises.length} vježbi</Text>
          </View>
          <Text style={styles.nextDayArrow}>▶</Text>
        </TouchableOpacity>
      )}

      {allDone && (
        <View style={styles.allDoneBanner}>
          <Text style={styles.allDoneEmoji}>🏆</Text>
          <Text style={styles.allDoneTitle}>Tjedan završen!</Text>
          <Text style={styles.allDoneSub}>Resetira se u ponedjeljak</Text>
        </View>
      )}

      {plan.notes && (
        <View style={styles.notesCard}>
          <Text style={styles.notesLabel}>📝 Napomena trenera</Text>
          <Text style={styles.notesText}>{plan.notes}</Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>Svi treninzi</Text>

      {plan.days.map((day) => {
        const isDone = completedThisWeek.includes(day.name)
        const isNext = nextDay?.name === day.name

        return (
          <TouchableOpacity
            key={day.day_number}
            style={[
              styles.dayCard,
              isDone && styles.dayCardDone,
              isNext && styles.dayCardNext,
            ]}
            onPress={() => openDay(day)}
            activeOpacity={0.85}
          >
            <View style={styles.dayCardLeft}>
              <View style={[styles.dayDot, isDone && styles.dayDotDone, isNext && styles.dayDotNext]} />
              <View>
                <Text style={[styles.dayName, isDone && styles.dayNameDone]}>{day.name}</Text>
                <Text style={styles.dayMeta}>
                  {day.exercises.length} vježbi
                  {isDone ? ' · ✓ Odraðeno ovaj tjedan' : isNext ? ' · Sljedeći na redu' : ''}
                </Text>
              </View>
            </View>
            {isDone
              ? <Text style={styles.dayDoneCheck}>✓</Text>
              : <Text style={styles.dayArrow}>→</Text>
            }
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
  emptyEmoji: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 8 },
  emptySub: { fontSize: 14, color: '#9ca3af', textAlign: 'center' },

  headerBg: {
    backgroundColor: '#1e3a5f', paddingTop: 60, paddingHorizontal: 20,
    paddingBottom: 24, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, marginBottom: 16,
  },
  headerLabel: { fontSize: 12, color: '#93c5fd', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
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
    padding: 20, alignItems: 'center', borderWidth: 1, borderColor: '#86efac',
  },
  allDoneEmoji: { fontSize: 36, marginBottom: 8 },
  allDoneTitle: { fontSize: 18, fontWeight: '800', color: '#15803d', marginBottom: 4 },
  allDoneSub: { fontSize: 13, color: '#4ade80' },

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
  backBtn: {
    marginBottom: 12,
    alignSelf: 'flex-start',
  },
  backBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 99,
    gap: 4,
  },
  backBtnArrow: {
    fontSize: 24,
    color: 'white',
    lineHeight: 26,
    fontWeight: '300',
  },
  backBtnText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
  },
  sessionTitle: { fontSize: 24, fontWeight: '800', color: 'white' },
  sessionDate: { fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 4 },
  sessionScroll: { flex: 1 },

  exerciseCard: {
    backgroundColor: 'white', borderRadius: 16, margin: 16, marginBottom: 0,
    padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  exerciseCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  exerciseNumBadge: {
    width: 32, height: 32, borderRadius: 10, backgroundColor: '#eff6ff',
    alignItems: 'center', justifyContent: 'center',
  },
  exerciseNumText: { fontSize: 13, fontWeight: '700', color: '#3b82f6' },
  exerciseCardInfo: { flex: 1 },
  exerciseCardName: { fontSize: 15, fontWeight: '700', color: '#111827' },
  exerciseCardTarget: { fontSize: 12, color: '#9ca3af', marginTop: 2 },

  lastLogRow: {
    backgroundColor: '#f8fafc', borderRadius: 8, padding: 8, marginBottom: 12,
  },
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
  setCheck: {
    alignItems: 'center', justifyContent: 'center',
    height: 36, borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb',
  },
  setCheckDone: { backgroundColor: '#22c55e', borderColor: '#22c55e' },
  setCheckText: { fontSize: 16, color: '#9ca3af' },
  exerciseNote: { fontSize: 12, color: '#9ca3af', marginTop: 8, fontStyle: 'italic' },

  saveBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 16, backgroundColor: 'white',
    borderTopWidth: 1, borderTopColor: '#f3f4f6',
  },
  saveBtn: {
    backgroundColor: '#3b82f6', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
  },
  saveBtnDone: { backgroundColor: '#22c55e' },
  saveBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },
})