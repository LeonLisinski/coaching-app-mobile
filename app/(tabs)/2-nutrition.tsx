import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/lib/LanguageContext'
import { useClient } from '@/lib/ClientContext'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useFocusEffect, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View
} from 'react-native';

type Ingredient = {
  food_id: string; name: string; grams: number
  calories: number; protein: number; carbs: number; fat: number
}

type MealWithRecipe = {
  id: string; meal_type: string; meal_order: number
  recipe_id: string | null; recipe_name: string | null
  calories: number; protein: number; carbs: number; fat: number
  ingredients: Ingredient[]
}

type MealPlan = {
  id: string; name: string; plan_type: string
  calories_target: number | null; protein_target: number | null
  carbs_target: number | null; fat_target: number | null
  meals: MealWithRecipe[]; assigned_at: string; notes: string | null
  client_id: string; trainer_id: string
}

type NutritionLog = {
  id: string; meals_completed: string[]
  calories: number | null; protein: number | null
  carbs: number | null; fat: number | null; confirmed: boolean
}

type MacroInput = { calories: string; protein: string; carbs: string; fat: string }

const MEAL_TYPE_LABELS: Record<string, string> = {
  breakfast: 'Doručak', lunch: 'Ručak', dinner: 'Večera', snack: 'Užina',
  pre_workout: 'Pred trening', post_workout: 'Nakon treninga',
  'Doručak': 'Doručak', 'Ručak': 'Ručak', 'Večera': 'Večera', 'Užina': 'Užina',
}

const getToday = () => {
  const now = new Date(Date.now() - 4 * 60 * 60 * 1000)
  return now.toISOString().split('T')[0]
}

const MACRO_COLORS = ['#f97316', '#3b82f6', '#10b981', '#8b5cf6']

// Format number to max 2 decimal places, strips trailing zeros
const n = (v: number | null | undefined): string => {
  if (v == null || isNaN(Number(v))) return '0'
  return parseFloat(Number(v).toFixed(2)).toString()
}

export default function NutritionScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const navigation = useNavigation()
  const { t, lang } = useLanguage()
  const { clientData: ctxClient } = useClient()
  const [plan, setPlan] = useState<MealPlan | null>(null)
  const [altPlan, setAltPlan] = useState<MealPlan | null>(null)
  const [planMode, setPlanMode] = useState<'training_day' | 'rest_day' | 'default' | null>(null)
  const [isTrainingDay, setIsTrainingDay] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [log, setLog] = useState<NutritionLog | null>(null)
  const [completedMeals, setCompletedMeals] = useState<string[]>([])
  const [macros, setMacros] = useState<MacroInput>({ calories: '', protein: '', carbs: '', fat: '' })
  const [saving, setSaving] = useState(false)
  const [expandedMeal, setExpandedMeal] = useState<string | null>(null)
  const [clientId, setClientId] = useState<string | null>(null)
  const [trainerId, setTrainerId] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState(getToday())
  const [loadingLog, setLoadingLog] = useState(false)
  const [minDate, setMinDate] = useState<string | null>(null)

  const today = getToday()
  const MAX_BACK_DAYS = 3

  // Timezone-safe date offset using UTC math on ISO date strings
  const offsetDate = (dateStr: string, days: number): string => {
    const [y, m, d] = dateStr.split('-').map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d + days))
    return dt.toISOString().split('T')[0]
  }

  const fmtSelectedDate = (dateStr: string): string => {
    if (dateStr === today) return t('today')
    const yesterday = offsetDate(today, -1)
    if (dateStr === yesterday) return lang === 'hr' ? 'Jučer' : 'Yesterday'
    const [y, m, d] = dateStr.split('-').map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d))
    return dt.toLocaleDateString(lang === 'hr' ? 'hr' : 'en', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  }

  // Min date: latest of (3 days ago) and (client start date)
  const hardMin = offsetDate(today, -MAX_BACK_DAYS)
  const effectiveMin = minDate && minDate > hardMin ? minDate : hardMin
  const canGoBack = selectedDate > effectiveMin
  const canGoForward = selectedDate < today

  useEffect(() => { fetchData() }, [])

  // Auto-save manually-entered macros to AsyncStorage on blur (meal toggles already saved to DB via upsertLog)
  useEffect(() => {
    const unsub = (navigation as any).addListener('blur', () => {
      if (!clientId || selectedDate !== today) return
      const hasAny = Object.values(macros).some(v => v && v !== '')
      if (!hasAny) return
      AsyncStorage.setItem(`nutrition-macros-draft-${clientId}-${today}`, JSON.stringify(macros)).catch(() => {})
    })
    return unsub
  }, [navigation, clientId, macros, selectedDate, today])

  // Real-time draft save — persists macros to AsyncStorage on every change so values
  // survive a crash or forced logout without waiting for a blur event
  useEffect(() => {
    if (!clientId || selectedDate !== today) return
    const hasAny = Object.values(macros).some(v => v && v !== '')
    if (!hasAny) return
    AsyncStorage.setItem(`nutrition-macros-draft-${clientId}-${today}`, JSON.stringify(macros)).catch(() => {})
  }, [macros])

  // When date changes (after initial load), just reload the log
  useEffect(() => {
    if (!clientId) return
    fetchLogForDate(clientId, selectedDate)
  }, [selectedDate])

  // Re-fetch log whenever screen comes into focus (e.g. returning from history)
  useFocusEffect(
    useCallback(() => {
      if (!clientId) return
      fetchLogForDate(clientId, selectedDate)
    }, [clientId, selectedDate]),
  )

  const fetchData = async () => {
    // Use shared ClientContext — avoids a redundant clients fetch
    // (created_at is not in context so we fetch a minimal profile if needed)
    const cId = ctxClient?.clientId
    const tId = ctxClient?.trainerId
    if (!cId || !tId) return setLoading(false)

    setClientId(cId)
    setTrainerId(tId)

    // Fetch created_at for minDate (not stored in context)
    supabase.from('clients').select('created_at').eq('id', cId).single()
      .then(({ data }) => { if (data?.created_at) setMinDate(data.created_at.split('T')[0]) })

    // Alias for the rest of the function body
    const clientData = { id: cId, trainer_id: tId }

    // Round 2: daily_log + meal plans in parallel (both only need clientData.id)
    const [{ data: dailyLog }, { data: allAssigned }] = await Promise.all([
      supabase.from('daily_logs')
        .select('is_training_day')
        .eq('client_id', clientData.id).eq('date', today).single(),
      supabase.from('client_meal_plans')
        .select('meal_plan_id, assigned_at, notes, plan_type')
        .eq('client_id', clientData.id).eq('active', true)
        .order('assigned_at', { ascending: false }),
    ])

    const todayIsTraining: boolean | null = dailyLog?.is_training_day ?? null
    setIsTrainingDay(todayIsTraining)

    if (!allAssigned || allAssigned.length === 0) return setLoading(false)

    const trainingPlan = allAssigned.find((p: any) => p.plan_type === 'training_day')
    const restPlan = allAssigned.find((p: any) => p.plan_type === 'rest_day')
    const defaultPlan = allAssigned.find((p: any) => p.plan_type === 'default' || !p.plan_type)

    let primaryAssigned = defaultPlan
    let mode: 'training_day' | 'rest_day' | 'default' = 'default'
    let altAssigned: any = null

    if (trainingPlan && restPlan) {
      if (todayIsTraining === true) {
        primaryAssigned = trainingPlan; mode = 'training_day'; altAssigned = restPlan
      } else if (todayIsTraining === false) {
        primaryAssigned = restPlan; mode = 'rest_day'; altAssigned = trainingPlan
      } else {
        primaryAssigned = defaultPlan || trainingPlan
        mode = defaultPlan ? 'default' : 'training_day'
        altAssigned = mode === 'training_day' ? restPlan : trainingPlan
      }
    } else if (trainingPlan) {
      primaryAssigned = trainingPlan; mode = 'training_day'
    } else if (restPlan) {
      primaryAssigned = restPlan; mode = 'rest_day'
    }

    setPlanMode(mode)
    if (!primaryAssigned) return setLoading(false)

    // Round 3: load primary plan + alt plan + today's log in parallel
    const [loadedPlan, loadedAlt] = await Promise.all([
      loadPlanData(primaryAssigned, clientData.id, clientData.trainer_id),
      altAssigned ? loadPlanData(altAssigned, clientData.id, clientData.trainer_id) : Promise.resolve(null),
      fetchLogForDate(clientData.id, selectedDate),
    ])

    if (loadedPlan) setPlan(loadedPlan)
    if (loadedAlt) setAltPlan(loadedAlt)
    setLoading(false)
  }

  const fetchLogForDate = async (cId: string, date: string) => {
    setLoadingLog(true)
    setLog(null)
    setCompletedMeals([])
    setMacros({ calories: '', protein: '', carbs: '', fat: '' })
    const { data: logData } = await supabase
      .from('nutrition_logs').select('*')
      .eq('client_id', cId).eq('date', date).single()
    if (logData) {
      setLog(logData)
      setCompletedMeals(logData.meals_completed || [])
      const dbMacros = {
        calories: logData.calories?.toString() || '',
        protein: logData.protein?.toString() || '',
        carbs: logData.carbs?.toString() || '',
        fat: logData.fat?.toString() || '',
      }
      setMacros(dbMacros)
    } else if (date === getToday()) {
      // No DB log yet — try to restore draft macros from AsyncStorage
      try {
        const raw = await AsyncStorage.getItem(`nutrition-macros-draft-${cId}-${date}`)
        if (raw) setMacros(JSON.parse(raw))
      } catch {}
    }
    setLoadingLog(false)
  }

  const loadPlanData = async (assigned: any, cId: string, tId: string): Promise<MealPlan | null> => {
    const { data: planData } = await supabase
      .from('meal_plans')
      .select('id, name, calories_target, protein_target, carbs_target, fat_target, meals')
      .eq('id', assigned.meal_plan_id).single()

    if (!planData) return null

    const meals = (planData.meals || []).map((m: any, i: number) => ({
      id: `meal-${i}`,
      meal_type: m.meal_type, meal_order: i,
      recipe_id: m.recipe_id || null, recipe_name: m.recipe_name || null,
      calories: m.calories || 0, protein: m.protein || 0,
      carbs: m.carbs || 0, fat: m.fat || 0, foods: m.custom_ingredients || m.foods || [],
    }))

    const recipeIds = meals.map((m: any) => m.recipe_id).filter(Boolean)
    let recipeMap: Record<string, Ingredient[]> = {}
    if (recipeIds.length > 0) {
      const { data: recipesData } = await supabase
        .from('recipes').select('id, ingredients').in('id', recipeIds)
      recipesData?.forEach((r: any) => { recipeMap[r.id] = r.ingredients || [] })
    }

    return {
      ...planData,
      plan_type: assigned.plan_type || 'default',
      meals: meals.map((m: any) => ({
        ...m, ingredients: m.recipe_id ? (recipeMap[m.recipe_id]?.length ? recipeMap[m.recipe_id] : (m.foods || [])) : (m.foods || []),
      })),
      assigned_at: assigned.assigned_at,
      notes: assigned.notes,
      client_id: cId,
      trainer_id: tId,
    }
  }

  const switchPlan = () => {
    if (!altPlan) return
    const current = plan
    setPlan(altPlan)
    setAltPlan(current)
    setPlanMode(planMode === 'training_day' ? 'rest_day' : 'training_day')
    setCompletedMeals([])
  }

  const toggleMeal = async (mealId: string) => {
    if (!plan || isConfirmed) return
    const prevCompleted = completedMeals
    const prevMacros = macros
    const newCompleted = completedMeals.includes(mealId)
      ? completedMeals.filter(id => id !== mealId)
      : [...completedMeals, mealId]
    setCompletedMeals(newCompleted)

    // Auto-recalculate macros from plan meal data whenever meals change
    const planHasMacros = plan.meals.some(m => (m.calories ?? 0) > 0)
    let updatedMacros = macros
    if (planHasMacros) {
      const checkedMeals = plan.meals.filter(m => newCompleted.includes(m.id))
      const totals = checkedMeals.reduce(
        (acc, m) => ({
          calories: acc.calories + (m.calories ?? 0),
          protein:  acc.protein  + (m.protein  ?? 0),
          carbs:    acc.carbs    + (m.carbs     ?? 0),
          fat:      acc.fat      + (m.fat       ?? 0),
        }),
        { calories: 0, protein: 0, carbs: 0, fat: 0 },
      )
      updatedMacros = {
        calories: totals.calories > 0 ? String(Math.round(totals.calories)) : '',
        protein:  totals.protein  > 0 ? String(Math.round(totals.protein))  : '',
        carbs:    totals.carbs    > 0 ? String(Math.round(totals.carbs))    : '',
        fat:      totals.fat      > 0 ? String(Math.round(totals.fat))      : '',
      }
      setMacros(updatedMacros)
    }

    const ok = await upsertLog(plan, newCompleted, updatedMacros, false)
    if (!ok) {
      // Rollback optimistic update on failure
      setCompletedMeals(prevCompleted)
      setMacros(prevMacros)
    }
  }

  const upsertLog = async (p: MealPlan, completed: string[], m: MacroInput, confirmed: boolean): Promise<boolean> => {
    const payload = {
      client_id: p.client_id, trainer_id: p.trainer_id,
      plan_id: p.id, date: selectedDate,
      meals_completed: completed,
      calories: m.calories ? parseFloat(m.calories) : null,
      protein: m.protein ? parseFloat(m.protein) : null,
      carbs: m.carbs ? parseFloat(m.carbs) : null,
      fat: m.fat ? parseFloat(m.fat) : null,
      confirmed,
    }
    if (log?.id) {
      const { data, error } = await supabase.from('nutrition_logs').update(payload).eq('id', log.id).select().single()
      if (error) { console.warn('upsertLog update error:', error.message); return false }
      if (data) setLog(data)
    } else {
      const { data, error } = await supabase.from('nutrition_logs').insert(payload).select().single()
      if (error) { console.warn('upsertLog insert error:', error.message); return false }
      if (data) setLog(data)
    }
    return true
  }

  const confirmDay = async () => {
    if (!plan) return
    setSaving(true)

    // macros are already in sync with completedMeals (kept up-to-date by toggleMeal).
    // If somehow macros are still empty AND plan has data, calculate as a fallback.
    const planHasMacros = plan.meals.some(m => (m.calories ?? 0) > 0)
    const hasAnyMacros = Object.values(macros).some(v => v && v !== '' && v !== '0')
    let finalMacros = macros

    if (!hasAnyMacros && planHasMacros && completedMeals.length > 0) {
      const checkedMeals = plan.meals.filter(m => completedMeals.includes(m.id))
      const totals = checkedMeals.reduce(
        (acc, m) => ({
          calories: acc.calories + (m.calories ?? 0),
          protein:  acc.protein  + (m.protein  ?? 0),
          carbs:    acc.carbs    + (m.carbs     ?? 0),
          fat:      acc.fat      + (m.fat       ?? 0),
        }),
        { calories: 0, protein: 0, carbs: 0, fat: 0 },
      )
      finalMacros = {
        calories: totals.calories > 0 ? String(Math.round(totals.calories)) : '',
        protein:  totals.protein  > 0 ? String(Math.round(totals.protein))  : '',
        carbs:    totals.carbs    > 0 ? String(Math.round(totals.carbs))    : '',
        fat:      totals.fat      > 0 ? String(Math.round(totals.fat))      : '',
      }
      setMacros(finalMacros)
    }

    await upsertLog(plan, completedMeals, finalMacros, true)
    // Clear draft since day is now confirmed
    if (clientId) AsyncStorage.removeItem(`nutrition-macros-draft-${clientId}-${selectedDate}`).catch(() => {})
    setSaving(false)
    Alert.alert(t('nutr_day_confirmed_alert'), t('nutr_day_confirmed_msg'))
  }

  if (loading) return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color="#10b981" />
    </View>
  )

  if (!plan || (isTrainingDay === null && !plan)) return (
    <View style={styles.emptyContainer}>
      <Text style={{ fontSize: 28, marginBottom: 10 }}>🥗</Text>
      <Text style={styles.emptyTitle}>{t('nutr_empty_title')}</Text>
      <Text style={styles.emptySub}>{t('nutr_empty_sub')}</Text>
    </View>
  )

  const isConfirmed = log?.confirmed || false
  const completedCount = completedMeals.length
  const totalMeals = plan!.meals.length

  // Banner when both plans exist but not answered yet
  const showUnansweredBanner = isTrainingDay === null && altPlan !== null

  const planBadge = planMode === 'training_day'
    ? { label: t('nutr_training_day'), sub: t('nutr_training_more') }
    : planMode === 'rest_day'
    ? { label: t('nutr_rest_day'), sub: t('nutr_rest_less') }
    : null

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">

        {/* Header */}
        <View style={[styles.headerBg, { paddingTop: insets.top + 12 }]}>
          <View style={styles.headerTop}>
            <Text style={styles.headerLabel}>{t('nutr_plan_label')}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                onPress={() => router.push('/nutrition-history')}
                style={styles.switchBtn}
                activeOpacity={0.75}
              >
                <Text style={styles.switchBtnText}>{t('nutr_history')}</Text>
              </TouchableOpacity>
              {altPlan && (
                <TouchableOpacity onPress={switchPlan} style={styles.switchBtn}>
                  <Text style={styles.switchBtnText}>
                    {planMode === 'training_day' ? t('nutr_switch_rest') : t('nutr_switch_train')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
          <Text style={styles.headerTitle}>{plan!.name}</Text>

          {planBadge && (
            <View style={styles.planBadge}>
              <Text style={styles.planBadgeText}>{planBadge.label}</Text>
              <Text style={styles.planBadgeSub}> · {planBadge.sub}</Text>
            </View>
          )}

          {(plan!.calories_target || plan!.protein_target) && (
            <View style={styles.macroRow}>
              {plan!.calories_target && (
                <View style={styles.macroItem}>
                  <Text style={styles.macroValue}>{plan!.calories_target}</Text>
                  <Text style={styles.macroLabel}>kcal</Text>
                </View>
              )}
              {plan!.protein_target && (
                <View style={styles.macroItem}>
                  <Text style={styles.macroValue}>{plan!.protein_target}g</Text>
                  <Text style={styles.macroLabel}>{t('nutr_protein')}</Text>
                </View>
              )}
              {plan!.carbs_target && (
                <View style={styles.macroItem}>
                  <Text style={styles.macroValue}>{plan!.carbs_target}g</Text>
                  <Text style={styles.macroLabel}>{t('nutr_carbs')}</Text>
                </View>
              )}
              {plan!.fat_target && (
                <View style={styles.macroItem}>
                  <Text style={styles.macroValue}>{plan!.fat_target}g</Text>
                  <Text style={styles.macroLabel}>{t('nutr_fat')}</Text>
                </View>
              )}
            </View>
          )}

          {/* Date navigation */}
          <View style={styles.dateNav}>
            <TouchableOpacity
              style={[styles.dateNavBtn, !canGoBack && styles.dateNavBtnDisabled]}
              onPress={() => { if (canGoBack) setSelectedDate(offsetDate(selectedDate, -1)) }}
              disabled={!canGoBack}
            >
              <Text style={[styles.dateNavArrow, !canGoBack && { opacity: 0.3 }]}>‹</Text>
            </TouchableOpacity>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={styles.dateNavLabel}>{fmtSelectedDate(selectedDate)}</Text>
              {selectedDate !== today && log?.confirmed && (
                <View style={styles.dateNavLockedBadge}>
                  <Text style={styles.dateNavLockedText}>🔒 {lang === 'hr' ? 'Zaključan dan' : 'Day locked'}</Text>
                </View>
              )}
            </View>
            <TouchableOpacity
              style={[styles.dateNavBtn, !canGoForward && styles.dateNavBtnDisabled]}
              onPress={() => { if (canGoForward) setSelectedDate(offsetDate(selectedDate, 1)) }}
              disabled={!canGoForward}
            >
              <Text style={[styles.dateNavArrow, !canGoForward && { opacity: 0.3 }]}>›</Text>
            </TouchableOpacity>
          </View>

          <View>
            <View style={styles.dayProgressHeader}>
              <Text style={styles.dayProgressLabel}>{completedCount} / {totalMeals} {t('nutr_meals_count')}</Text>
            </View>
            <View style={styles.dayProgressBar}>
              <View style={[styles.dayProgressFill, {
                width: totalMeals > 0 ? `${(completedCount / totalMeals) * 100}%` as any : '0%',
                backgroundColor: isConfirmed ? '#22c55e' : '#10b981',
              }]} />
            </View>
          </View>
        </View>

        {/* Unanswered banner — nudge to go answer on home */}
        {showUnansweredBanner && (
          <View style={styles.unansweredBanner}>
            <View style={{ flex: 1 }}>
              <Text style={styles.unansweredTitle}>{t('nutr_unanswered_title')}</Text>
              <Text style={styles.unansweredSub}>{t('nutr_unanswered_sub')}</Text>
            </View>
          </View>
        )}

        {isConfirmed && (
          <View style={styles.confirmedBanner}>
            <View style={styles.confirmedCheck}><Text style={styles.confirmedCheckText}>✓</Text></View>
            <View>
              <Text style={styles.confirmedTitle}>{t('nutr_confirmed_title')}</Text>
              <Text style={styles.confirmedSub}>{t('nutr_confirmed_sub')}</Text>
            </View>
          </View>
        )}

        {plan!.notes && (
          <View style={styles.notesCard}>
            <Text style={styles.notesLabel}>{t('trainer_note')}</Text>
            <Text style={styles.notesText}>{plan!.notes}</Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>{t('nutr_meals_title')}</Text>
        {plan!.meals.map((meal) => {
          const isCompleted = completedMeals.includes(meal.id)
          const isExpanded = expandedMeal === meal.id

          return (
            <View key={meal.id} style={[styles.mealCard, isCompleted && styles.mealCardDone]}>
              <View style={styles.mealHeader}>
                <TouchableOpacity
                  style={styles.mealCheckBtn}
                  onPress={() => toggleMeal(meal.id)}
                  disabled={isConfirmed}
                  activeOpacity={isConfirmed ? 1 : 0.7}
                >
                  <View style={[styles.mealCheck, isCompleted && styles.mealCheckDone, isConfirmed && { opacity: 0.7 }]}>
                    {isCompleted && <Text style={styles.mealCheckText}>✓</Text>}
                  </View>
                </TouchableOpacity>
                <TouchableOpacity style={styles.mealInfo} onPress={() => setExpandedMeal(isExpanded ? null : meal.id)}>
                  <Text style={[styles.mealType, isCompleted && styles.mealTypeDone]}>
                    {MEAL_TYPE_LABELS[meal.meal_type] || meal.meal_type}
                  </Text>
                  {meal.recipe_name && (
                    <Text style={styles.mealMeta}>{meal.recipe_name} · {n(meal.calories)} kcal</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setExpandedMeal(isExpanded ? null : meal.id)}>
                  <Text style={styles.expandIcon}>{isExpanded ? '▲' : '▼'}</Text>
                </TouchableOpacity>
              </View>

              {isExpanded && (
                <View style={styles.foodList}>
                  <View style={styles.mealMacroRow}>
                    {[
                      { v: n(meal.calories), l: 'kcal' },
                      { v: `${n(meal.protein)}g`, l: t('nutr_protein') },
                      { v: `${n(meal.carbs)}g`, l: t('nutr_carbs') },
                      { v: `${n(meal.fat)}g`, l: t('nutr_fat') },
                    ].map((item, i) => (
                      <View key={i} style={{ flex: 1, alignItems: 'center' }}>
                        <Text style={[styles.mealMacroValue, { color: MACRO_COLORS[i] }]}>{item.v}</Text>
                        <Text style={styles.mealMacroLabel}>{item.l}</Text>
                        {i < 3 && <View style={styles.mealMacroDivider} />}
                      </View>
                    ))}
                  </View>

                  {meal.ingredients?.length > 0 && (
                    <>
                      <Text style={styles.ingredientsTitle}>{t('nutr_ingredients')}</Text>
                      {meal.ingredients.map((ing: Ingredient, i: number) => (
                        <View key={i} style={styles.ingredientRow}>
                          <View style={styles.ingredientLeft}>
                            <View style={styles.foodNum}>
                              <Text style={styles.foodNumText}>{i + 1}</Text>
                            </View>
                            <View>
                              <Text style={styles.ingredientName}>{ing.name}</Text>
                              <Text style={styles.ingredientGrams}>{n(ing.grams)}g</Text>
                            </View>
                          </View>
                          <View style={styles.ingredientMacros}>
                            <Text style={styles.ingredientCal}>{n(ing.calories)} kcal</Text>
                            <View style={styles.ingredientTags}>
                              <Text style={styles.ingredientTag}>P: {n(ing.protein)}g</Text>
                              <Text style={styles.ingredientTag}>C: {n(ing.carbs)}g</Text>
                              <Text style={styles.ingredientTag}>M: {n(ing.fat)}g</Text>
                            </View>
                          </View>
                        </View>
                      ))}
                    </>
                  )}
                </View>
              )}
            </View>
          )
        })}

        <Text style={styles.sectionTitle}>{t('nutr_macros_title')}</Text>
        <View style={styles.macroInputCard}>
          <Text style={styles.macroInputDesc}>{t('nutr_macros_desc')}</Text>
          <View style={styles.macroInputGrid}>
            {[
              { key: 'calories', label: t('nutr_kcal'), unit: 'kcal', color: '#f97316' },
              { key: 'protein', label: t('nutr_protein'), unit: 'g', color: '#3b82f6' },
              { key: 'carbs', label: t('nutr_carbs'), unit: 'g', color: '#10b981' },
              { key: 'fat', label: t('nutr_fat'), unit: 'g', color: '#8b5cf6' },
            ].map(item => (
              <View key={item.key} style={styles.macroInputItem}>
                <Text style={[styles.macroInputLabel, { color: item.color }]}>{item.label}</Text>
                <View style={styles.macroInputRow}>
                  <TextInput
                    style={styles.macroInputField}
                    value={macros[item.key as keyof MacroInput]}
                    onChangeText={v => setMacros(prev => ({ ...prev, [item.key]: v }))}
                    placeholder="0" placeholderTextColor="#d1d5db"
                    keyboardType="number-pad" editable={!isConfirmed}
                  />
                  <Text style={styles.macroInputUnit}>{item.unit}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>

      <View style={styles.stickyFooter}>
        {!isConfirmed ? (
          <TouchableOpacity style={styles.confirmBtn} onPress={confirmDay} disabled={saving}>
            <Text style={styles.confirmBtnText}>{saving ? t('nutr_saving') : t('nutr_confirm_btn')}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.editBtn}
            onPress={() => {
              if (!log) return
              supabase.from('nutrition_logs').update({ confirmed: false })
                .eq('id', log.id)
                .then(() => {
                  setLog(prev => prev ? { ...prev, confirmed: false } : null)
                  // Recalculate macros from currently checked meals so editing starts fresh
                  if (plan) {
                    const planHasMacros = plan.meals.some(m => (m.calories ?? 0) > 0)
                    if (planHasMacros) {
                      const checkedMeals = plan.meals.filter(m => completedMeals.includes(m.id))
                      const totals = checkedMeals.reduce(
                        (acc, m) => ({
                          calories: acc.calories + (m.calories ?? 0),
                          protein:  acc.protein  + (m.protein  ?? 0),
                          carbs:    acc.carbs    + (m.carbs     ?? 0),
                          fat:      acc.fat      + (m.fat       ?? 0),
                        }),
                        { calories: 0, protein: 0, carbs: 0, fat: 0 },
                      )
                      setMacros({
                        calories: totals.calories > 0 ? String(Math.round(totals.calories)) : '',
                        protein:  totals.protein  > 0 ? String(Math.round(totals.protein))  : '',
                        carbs:    totals.carbs    > 0 ? String(Math.round(totals.carbs))    : '',
                        fat:      totals.fat      > 0 ? String(Math.round(totals.fat))      : '',
                      })
                    }
                  }
                })
            }}
          >
            <Text style={styles.editBtnText}>{t('nutr_edit_btn')}</Text>
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
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 8 },
  emptySub: { fontSize: 14, color: '#9ca3af', textAlign: 'center' },

  headerBg: {
    backgroundColor: '#064e3b', paddingHorizontal: 20,
    paddingBottom: 24, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, marginBottom: 16,
  },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  headerLabel: { fontSize: 12, color: '#6ee7b7', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  headerTitle: { fontSize: 26, fontWeight: '800', color: 'white', marginBottom: 10 },

  switchBtn: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 99, paddingHorizontal: 12, paddingVertical: 5 },
  switchBtnText: { fontSize: 12, color: 'white', fontWeight: '600' },

  planBadge: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 12, alignSelf: 'flex-start' },
  planBadgeText: { fontSize: 13, color: 'rgba(255,255,255,0.95)', fontWeight: '700' },
  planBadgeSub: { fontSize: 12, color: 'rgba(255,255,255,0.6)' },

  macroRow: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 14, padding: 12, gap: 8, marginBottom: 16 },
  macroItem: { flex: 1, alignItems: 'center' },
  macroValue: { fontSize: 16, fontWeight: '800', color: 'white' },
  macroLabel: { fontSize: 10, color: '#6ee7b7', marginTop: 2, textAlign: 'center' },

  dateNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 12,
    paddingHorizontal: 4, paddingVertical: 4, marginBottom: 14,
  },
  dateNavBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  dateNavBtnDisabled: { opacity: 0.3 },
  dateNavArrow: { fontSize: 22, color: 'white', fontWeight: '300' },
  dateNavLabel: { fontSize: 14, fontWeight: '700', color: 'white', textAlign: 'center' },
  dateNavLockedBadge: {
    marginTop: 3, backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  dateNavLockedText: { fontSize: 10, color: 'rgba(255,255,255,0.85)', fontWeight: '600' },

  dayProgressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  dayProgressLabel: { fontSize: 12, color: 'rgba(255,255,255,0.7)' },
  dayProgressCount: { fontSize: 12, fontWeight: '700', color: 'white' },
  dayProgressBar: { height: 6, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 99, overflow: 'hidden' },
  dayProgressFill: { height: '100%', borderRadius: 99 },

  unansweredBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fefce8', borderRadius: 14, marginHorizontal: 20, marginBottom: 12,
    padding: 14, borderWidth: 1, borderColor: '#fde68a',
  },
  unansweredTitle: { fontSize: 14, fontWeight: '700', color: '#92400e' },
  unansweredSub: { fontSize: 12, color: '#b45309', marginTop: 2 },

  confirmedBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#f0fdf4', borderRadius: 14, marginHorizontal: 20, marginBottom: 12, padding: 14, borderWidth: 1, borderColor: '#86efac' },
  confirmedCheck: { width: 32, height: 32, borderRadius: 99, backgroundColor: '#22c55e', alignItems: 'center', justifyContent: 'center' },
  confirmedCheckText: { color: 'white', fontSize: 16, fontWeight: '700' },
  confirmedTitle: { fontSize: 15, fontWeight: '700', color: '#15803d' },
  confirmedSub: { fontSize: 12, color: '#86efac', marginTop: 2 },

  notesCard: { backgroundColor: '#fffbeb', borderRadius: 14, padding: 14, marginHorizontal: 20, marginBottom: 16, borderLeftWidth: 3, borderLeftColor: '#f59e0b' },
  notesLabel: { fontSize: 12, fontWeight: '700', color: '#92400e', marginBottom: 4 },
  notesText: { fontSize: 13, color: '#78350f', lineHeight: 20 },

  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10, marginHorizontal: 20 },

  mealCard: { backgroundColor: 'white', borderRadius: 16, marginHorizontal: 20, marginBottom: 10, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  mealCardDone: { borderWidth: 1, borderColor: '#86efac' },
  mealHeader: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  mealCheckBtn: { padding: 4 },
  mealCheck: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center' },
  mealCheckDone: { backgroundColor: '#22c55e', borderColor: '#22c55e' },
  mealCheckText: { color: 'white', fontSize: 13, fontWeight: '700' },
  mealInfo: { flex: 1 },
  mealType: { fontSize: 15, fontWeight: '600', color: '#111827', marginBottom: 2 },
  mealTypeDone: { color: '#15803d' },
  mealMeta: { fontSize: 12, color: '#9ca3af' },
  expandIcon: { fontSize: 11, color: '#9ca3af' },

  foodList: { borderTopWidth: 1, borderTopColor: '#f3f4f6', padding: 12, gap: 10 },
  foodNum: { width: 24, height: 24, borderRadius: 6, backgroundColor: '#f0fdf4', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 },
  foodNumText: { fontSize: 11, fontWeight: '700', color: '#10b981' },

  mealMacroRow: { flexDirection: 'row', backgroundColor: '#f8fafc', borderRadius: 10, padding: 12, marginBottom: 12 },
  mealMacroValue: { fontSize: 15, fontWeight: '700', color: '#111827', textAlign: 'center' },
  mealMacroLabel: { fontSize: 10, color: '#9ca3af', marginTop: 2, textAlign: 'center' },
  mealMacroDivider: { position: 'absolute', right: 0, top: 4, bottom: 4, width: 1, backgroundColor: '#e5e7eb' },

  ingredientsTitle: { fontSize: 11, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  ingredientRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  ingredientLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ingredientName: { fontSize: 14, fontWeight: '600', color: '#111827' },
  ingredientGrams: { fontSize: 12, color: '#9ca3af', marginTop: 1 },
  ingredientMacros: { alignItems: 'flex-end' },
  ingredientCal: { fontSize: 13, fontWeight: '700', color: '#f97316', marginBottom: 2 },
  ingredientTags: { flexDirection: 'row', gap: 6 },
  ingredientTag: { fontSize: 11, color: '#6b7280' },

  macroInputCard: { backgroundColor: 'white', borderRadius: 16, marginHorizontal: 20, marginBottom: 12, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  macroInputDesc: { fontSize: 13, color: '#9ca3af', marginBottom: 14 },
  macroInputGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  macroInputItem: { width: '47%' },
  macroInputLabel: { fontSize: 12, fontWeight: '600', marginBottom: 6 },
  macroInputRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, overflow: 'hidden' },
  macroInputField: { flex: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, fontWeight: '600', color: '#111827' },
  macroInputUnit: { paddingHorizontal: 10, fontSize: 12, color: '#9ca3af', backgroundColor: '#f9fafb', paddingVertical: 10 },

  stickyFooter: { padding: 16, backgroundColor: 'white', borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  confirmBtn: { backgroundColor: '#10b981', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  confirmBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },
  editBtn: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  editBtnText: { color: '#6b7280', fontSize: 14, fontWeight: '600' },
})
