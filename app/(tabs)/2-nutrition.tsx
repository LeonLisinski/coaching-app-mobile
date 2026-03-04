import { supabase } from '@/lib/supabase'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'

type Food = {
  food_id?: string
  name?: string
  amount?: number
  unit?: string
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
}

type Ingredient = {
  food_id: string
  name: string
  grams: number
  calories: number
  protein: number
  carbs: number
  fat: number
}

type MealWithRecipe = {
  id: string
  meal_type: string
  meal_order: number
  recipe_id: string | null
  recipe_name: string | null
  calories: number
  protein: number
  carbs: number
  fat: number
  ingredients: Ingredient[]
}

type Meal = {
  id: string
  meal_type: string
  meal_order: number
  recipe_id?: string | null
  recipe_name?: string | null
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  foods?: Food[]
}

type MealPlan = {
  id: string
  name: string
  calories_target: number | null
  protein_target: number | null
  carbs_target: number | null
  fat_target: number | null
  meals: MealWithRecipe[]
  assigned_at: string
  notes: string | null
  client_id: string
  trainer_id: string
}

type NutritionLog = {
  id: string
  meals_completed: string[]
  calories: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
  confirmed: boolean
}

type MacroInput = {
  calories: string
  protein: string
  carbs: string
  fat: string
}

const MEAL_TYPE_LABELS: Record<string, string> = {
  breakfast: 'Doručak',
  lunch: 'Ručak',
  dinner: 'Večera',
  snack: 'Užina',
  pre_workout: 'Pred trening',
  post_workout: 'Nakon treninga',
  'Doručak': 'Doručak',
  'Ručak': 'Ručak',
  'Večera': 'Večera',
  'Užina': 'Užina',
}

const today = new Date().toISOString().split('T')[0]

export default function NutritionScreen() {
  const [plan, setPlan] = useState<MealPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [log, setLog] = useState<NutritionLog | null>(null)
  const [completedMeals, setCompletedMeals] = useState<string[]>([])
  const [macros, setMacros] = useState<MacroInput>({ calories: '', protein: '', carbs: '', fat: '' })
  const [saving, setSaving] = useState(false)
  const [expandedMeal, setExpandedMeal] = useState<string | null>(null)

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: clientData } = await supabase
      .from('clients').select('id, trainer_id').eq('user_id', user.id).single()
    if (!clientData) return setLoading(false)

    const { data: assigned } = await supabase
      .from('client_meal_plans')
      .select('meal_plan_id, assigned_at, notes')
      .eq('client_id', clientData.id)
      .eq('active', true)
      .order('assigned_at', { ascending: false })
      .limit(1)
      .single()

    if (!assigned) return setLoading(false)

    const { data: planData } = await supabase
      .from('meal_plans')
      .select('id, name, calories_target, protein_target, carbs_target, fat_target, meals')
      .eq('id', assigned.meal_plan_id)
      .single()

    if (!planData) return setLoading(false)

    // Mapiramo meals iz JSONB u isti format kao prije
    const meals = (planData.meals || []).map((m: any, i: number) => ({
      id: `meal-${i}`,
      meal_type: m.meal_type,
      meal_order: i,
      recipe_id: m.recipe_id || null,
      recipe_name: m.recipe_name || null,
      calories: m.calories || 0,
      protein: m.protein || 0,
      carbs: m.carbs || 0,
      fat: m.fat || 0,
      foods: m.foods || [],
    }))

    // Dohvati ingredijente za svaki recept
    const recipeIds = meals.map((m: any) => m.recipe_id).filter(Boolean)
    let recipeMap: Record<string, Ingredient[]> = {}

    if (recipeIds.length > 0) {
      const { data: recipesData } = await supabase
        .from('recipes')
        .select('id, ingredients')
        .in('id', recipeIds)

      recipesData?.forEach((r: { id: string; ingredients?: Ingredient[] }) => {
        recipeMap[r.id] = r.ingredients || []
      })
    }

    const mealsWithIngredients = meals.map((m: any) => ({
      ...m,
      ingredients: m.recipe_id ? (recipeMap[m.recipe_id] || []) : [],
    }))

    setPlan({
      ...planData,
      meals: mealsWithIngredients,
      assigned_at: assigned.assigned_at,
      notes: assigned.notes,
      client_id: clientData.id,
      trainer_id: clientData.trainer_id,
    })

    const { data: logData } = await supabase
      .from('nutrition_logs')
      .select('*')
      .eq('client_id', clientData.id)
      .eq('date', today)
      .single()

    if (logData) {
      setLog(logData)
      setCompletedMeals(logData.meals_completed || [])
      setMacros({
        calories: logData.calories?.toString() || '',
        protein: logData.protein?.toString() || '',
        carbs: logData.carbs?.toString() || '',
        fat: logData.fat?.toString() || '',
      })
    }

    setLoading(false)
  }

  const toggleMeal = async (mealId: string) => {
    if (!plan) return
    const newCompleted = completedMeals.includes(mealId)
      ? completedMeals.filter(id => id !== mealId)
      : [...completedMeals, mealId]

    setCompletedMeals(newCompleted)
    await upsertLog(plan, newCompleted, macros, log?.confirmed || false)
  }

  const upsertLog = async (
    p: MealPlan,
    completed: string[],
    m: MacroInput,
    confirmed: boolean
  ) => {
    const payload = {
      client_id: p.client_id,
      trainer_id: p.trainer_id,
      plan_id: p.id,
      date: today,
      meals_completed: completed,
      calories: m.calories ? parseInt(m.calories) : null,
      protein: m.protein ? parseInt(m.protein) : null,
      carbs: m.carbs ? parseInt(m.carbs) : null,
      fat: m.fat ? parseInt(m.fat) : null,
      confirmed,
    }

    if (log?.id) {
      const { data } = await supabase
        .from('nutrition_logs')
        .update(payload)
        .eq('id', log.id)
        .select()
        .single()
      if (data) setLog(data)
    } else {
      const { data } = await supabase
        .from('nutrition_logs')
        .insert(payload)
        .select()
        .single()
      if (data) setLog(data)
    }
  }

  const confirmDay = async () => {
    if (!plan) return
    setSaving(true)
    await upsertLog(plan, completedMeals, macros, true)
    setSaving(false)
    Alert.alert('✓ Dan potvrðen!', 'Tvoj unos za danas je spremljen.')
  }

  const getMealCalories = (meal: any) => meal.calories || 0

  if (loading) return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color="#10b981" />
    </View>
  )

  if (!plan) return (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyEmoji}>🥗</Text>
      <Text style={styles.emptyTitle}>Nema aktivnog plana</Text>
      <Text style={styles.emptySub}>Tvoj trener još nije dodijelio plan prehrane.</Text>
    </View>
  )

  const totalCalories = plan.meals.reduce((sum, m) => sum + getMealCalories(m), 0)
  const isConfirmed = log?.confirmed || false
  const completedCount = completedMeals.length
  const totalMeals = plan.meals.length

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
          <Text style={styles.headerLabel}>Plan prehrane</Text>
          <Text style={styles.headerTitle}>{plan.name}</Text>

          {/* Makro targeti */}
          {(plan.calories_target || plan.protein_target) && (
            <View style={styles.macroRow}>
              {plan.calories_target && (
                <View style={styles.macroItem}>
                  <Text style={styles.macroValue}>{plan.calories_target}</Text>
                  <Text style={styles.macroLabel}>kcal</Text>
                </View>
              )}
              {plan.protein_target && (
                <View style={styles.macroItem}>
                  <Text style={styles.macroValue}>{plan.protein_target}g</Text>
                  <Text style={styles.macroLabel}>Proteini</Text>
                </View>
              )}
              {plan.carbs_target && (
                <View style={styles.macroItem}>
                  <Text style={styles.macroValue}>{plan.carbs_target}g</Text>
                  <Text style={styles.macroLabel}>Ugljikohidrati</Text>
                </View>
              )}
              {plan.fat_target && (
                <View style={styles.macroItem}>
                  <Text style={styles.macroValue}>{plan.fat_target}g</Text>
                  <Text style={styles.macroLabel}>Masti</Text>
                </View>
              )}
            </View>
          )}

          {/* Dnevni progress */}
          <View style={styles.dayProgress}>
            <View style={styles.dayProgressHeader}>
              <Text style={styles.dayProgressLabel}>Danas</Text>
              <Text style={styles.dayProgressCount}>{completedCount} / {totalMeals} obroka</Text>
            </View>
            <View style={styles.dayProgressBar}>
              <View style={[styles.dayProgressFill, {
                width: totalMeals > 0 ? `${(completedCount / totalMeals) * 100}%` as any : '0%',
                backgroundColor: isConfirmed ? '#22c55e' : '#10b981',
              }]} />
            </View>
          </View>
        </View>

        {/* Potvrðeno banner */}
        {isConfirmed && (
          <View style={styles.confirmedBanner}>
            <Text style={styles.confirmedEmoji}>✅</Text>
            <View>
              <Text style={styles.confirmedTitle}>Dan potvrđen!</Text>
              <Text style={styles.confirmedSub}>Prehrana za danas je zapisana</Text>
            </View>
          </View>
        )}

        {/* Notes */}
        {plan.notes && (
          <View style={styles.notesCard}>
            <Text style={styles.notesLabel}>📝 Napomena trenera</Text>
            <Text style={styles.notesText}>{plan.notes}</Text>
          </View>
        )}

        {/* Obroci */}
        <Text style={styles.sectionTitle}>Obroci</Text>
        {plan.meals.map((meal) => {
          const isCompleted = completedMeals.includes(meal.id)
          const isExpanded = expandedMeal === meal.id
          const mealCals = getMealCalories(meal)

          return (
            <View key={meal.id} style={[styles.mealCard, isCompleted && styles.mealCardDone]}>
              {/* Meal header */}
              <View style={styles.mealHeader}>
                <TouchableOpacity
                  style={styles.mealCheckBtn}
                  onPress={() => toggleMeal(meal.id)}
                >
                  <View style={[styles.mealCheck, isCompleted && styles.mealCheckDone]}>
                    {isCompleted && <Text style={styles.mealCheckText}>✓</Text>}
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.mealInfo}
                  onPress={() => setExpandedMeal(isExpanded ? null : meal.id)}
                >
                  <Text style={[styles.mealType, isCompleted && styles.mealTypeDone]}>
                    {MEAL_TYPE_LABELS[meal.meal_type] || meal.meal_type}
                  </Text>
                  {meal.recipe_name && (
                    <Text style={styles.mealMeta}>{meal.recipe_name} · {mealCals} kcal</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setExpandedMeal(isExpanded ? null : meal.id)}>
                  <Text style={styles.expandIcon}>{isExpanded ? '▲' : '▼'}</Text>
                </TouchableOpacity>
              </View>

              {isExpanded && (
                <View style={styles.foodList}>
                  {/* Makroi obroka */}
                  <View style={styles.mealMacroRow}>
                    <View style={styles.mealMacroItem}>
                      <Text style={styles.mealMacroValue}>{meal.calories}</Text>
                      <Text style={styles.mealMacroLabel}>kcal</Text>
                    </View>
                    <View style={styles.mealMacroDivider} />
                    <View style={styles.mealMacroItem}>
                      <Text style={styles.mealMacroValue}>{meal.protein}g</Text>
                      <Text style={styles.mealMacroLabel}>Proteini</Text>
                    </View>
                    <View style={styles.mealMacroDivider} />
                    <View style={styles.mealMacroItem}>
                      <Text style={styles.mealMacroValue}>{meal.carbs}g</Text>
                      <Text style={styles.mealMacroLabel}>Ugljikohidrati</Text>
                    </View>
                    <View style={styles.mealMacroDivider} />
                    <View style={styles.mealMacroItem}>
                      <Text style={styles.mealMacroValue}>{meal.fat}g</Text>
                      <Text style={styles.mealMacroLabel}>Masti</Text>
                    </View>
                  </View>

                  {/* Sastojci */}
                  {meal.ingredients?.length > 0 && (
                    <>
                      <Text style={styles.ingredientsTitle}>Sastojci</Text>
                      {meal.ingredients.map((ing: Ingredient, i: number) => (
                        <View key={i} style={styles.ingredientRow}>
                          <View style={styles.ingredientLeft}>
                            <View style={styles.foodNum}>
                              <Text style={styles.foodNumText}>{i + 1}</Text>
                            </View>
                            <View>
                              <Text style={styles.ingredientName}>{ing.name}</Text>
                              <Text style={styles.ingredientGrams}>{ing.grams}g</Text>
                            </View>
                          </View>
                          <View style={styles.ingredientMacros}>
                            <Text style={styles.ingredientCal}>{ing.calories} kcal</Text>
                            <View style={styles.ingredientTags}>
                              <Text style={styles.ingredientTag}>P: {ing.protein}g</Text>
                              <Text style={styles.ingredientTag}>C: {ing.carbs}g</Text>
                              <Text style={styles.ingredientTag}>M: {ing.fat}g</Text>
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

        {/* Unos makroa */}
        <Text style={styles.sectionTitle}>Unos makroa za danas</Text>
        <View style={styles.macroInputCard}>
          <Text style={styles.macroInputDesc}>
            Unesi stvarno konzumirane makroe na kraju dana
          </Text>
          <View style={styles.macroInputGrid}>
            {[
              { key: 'calories', label: 'Kalorije', unit: 'kcal', color: '#f97316' },
              { key: 'protein', label: 'Proteini', unit: 'g', color: '#3b82f6' },
              { key: 'carbs', label: 'Ugljikohidrati', unit: 'g', color: '#10b981' },
              { key: 'fat', label: 'Masti', unit: 'g', color: '#8b5cf6' },
            ].map(item => (
              <View key={item.key} style={styles.macroInputItem}>
                <Text style={[styles.macroInputLabel, { color: item.color }]}>{item.label}</Text>
                <View style={styles.macroInputRow}>
                  <TextInput
                    style={styles.macroInputField}
                    value={macros[item.key as keyof MacroInput]}
                    onChangeText={v => setMacros(prev => ({ ...prev, [item.key]: v }))}
                    placeholder="0"
                    placeholderTextColor="#d1d5db"
                    keyboardType="number-pad"
                    editable={!isConfirmed}
                  />
                  <Text style={styles.macroInputUnit}>{item.unit}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* Sticky footer */}
      <View style={styles.stickyFooter}>
        {!isConfirmed ? (
          <TouchableOpacity style={styles.confirmBtn} onPress={confirmDay} disabled={saving}>
            <Text style={styles.confirmBtnText}>
              {saving ? 'Sprema...' : '✓ Potvrdi dan'}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.editBtn}
            onPress={() => log && supabase.from('nutrition_logs').update({ confirmed: false }).eq('id', log.id).then(() => setLog(prev => prev ? { ...prev, confirmed: false } : null))}
          >
            <Text style={styles.editBtnText}>Uredi unos</Text>
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
  emptyEmoji: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 8 },
  emptySub: { fontSize: 14, color: '#9ca3af', textAlign: 'center' },

  headerBg: {
    backgroundColor: '#064e3b', paddingTop: 60, paddingHorizontal: 20,
    paddingBottom: 24, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, marginBottom: 16,
  },
  headerLabel: { fontSize: 12, color: '#6ee7b7', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
  headerTitle: { fontSize: 26, fontWeight: '800', color: 'white', marginBottom: 16 },

  macroRow: {
    flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14, padding: 12, gap: 8, marginBottom: 16,
  },
  macroItem: { flex: 1, alignItems: 'center' },
  macroValue: { fontSize: 16, fontWeight: '800', color: 'white' },
  macroLabel: { fontSize: 10, color: '#6ee7b7', marginTop: 2, textAlign: 'center' },

  dayProgress: {},
  dayProgressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  dayProgressLabel: { fontSize: 12, color: 'rgba(255,255,255,0.7)' },
  dayProgressCount: { fontSize: 12, fontWeight: '700', color: 'white' },
  dayProgressBar: { height: 6, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 99, overflow: 'hidden' },
  dayProgressFill: { height: '100%', borderRadius: 99 },

  confirmedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#f0fdf4', borderRadius: 14, marginHorizontal: 20,
    marginBottom: 12, padding: 14, borderWidth: 1, borderColor: '#86efac',
  },
  confirmedEmoji: { fontSize: 28 },
  confirmedTitle: { fontSize: 15, fontWeight: '700', color: '#15803d' },
  confirmedSub: { fontSize: 12, color: '#4ade80', marginTop: 2 },

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

  mealCard: {
    backgroundColor: 'white', borderRadius: 16, marginHorizontal: 20,
    marginBottom: 10, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  mealCardDone: { borderWidth: 1, borderColor: '#86efac' },
  mealHeader: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  mealCheckBtn: { padding: 4 },
  mealCheck: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 2, borderColor: '#e5e7eb',
    alignItems: 'center', justifyContent: 'center',
  },
  mealCheckDone: { backgroundColor: '#22c55e', borderColor: '#22c55e' },
  mealCheckText: { color: 'white', fontSize: 13, fontWeight: '700' },
  mealInfo: { flex: 1 },
  mealType: { fontSize: 15, fontWeight: '600', color: '#111827', marginBottom: 2 },
  mealTypeDone: { color: '#15803d' },
  mealMeta: { fontSize: 12, color: '#9ca3af' },
  expandIcon: { fontSize: 11, color: '#9ca3af' },

  foodList: { borderTopWidth: 1, borderTopColor: '#f3f4f6', padding: 12, gap: 10 },
  foodRow: { flexDirection: 'row', gap: 10 },
  foodNum: {
    width: 24, height: 24, borderRadius: 6, backgroundColor: '#f0fdf4',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2,
  },
  foodNumText: { fontSize: 11, fontWeight: '700', color: '#10b981' },
  foodInfo: { flex: 1 },
  foodName: { fontSize: 14, fontWeight: '600', color: '#111827', marginBottom: 4 },
  foodTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  tag: { backgroundColor: '#f3f4f6', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 99 },
  tagText: { fontSize: 11, color: '#6b7280' },
  tagOrange: { backgroundColor: '#fff7ed' },
  tagOrangeText: { color: '#ea580c' },
  tagBlue: { backgroundColor: '#eff6ff' },
  tagBlueText: { color: '#3b82f6' },
  tagGreen: { backgroundColor: '#f0fdf4' },
  tagGreenText: { color: '#10b981' },

  mealMacroRow: {
    flexDirection: 'row', backgroundColor: '#f8fafc',
    borderRadius: 10, padding: 12, marginBottom: 12,
  },
  mealMacroItem: { flex: 1, alignItems: 'center' },
  mealMacroDivider: { width: 1, backgroundColor: '#e5e7eb', marginVertical: 2 },
  mealMacroValue: { fontSize: 15, fontWeight: '700', color: '#111827' },
  mealMacroLabel: { fontSize: 10, color: '#9ca3af', marginTop: 2 },

  ingredientsTitle: {
    fontSize: 11, fontWeight: '700', color: '#9ca3af',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
  },
  ingredientRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  ingredientLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ingredientName: { fontSize: 14, fontWeight: '600', color: '#111827' },
  ingredientGrams: { fontSize: 12, color: '#9ca3af', marginTop: 1 },
  ingredientMacros: { alignItems: 'flex-end' },
  ingredientCal: { fontSize: 13, fontWeight: '700', color: '#f97316', marginBottom: 2 },
  ingredientTags: { flexDirection: 'row', gap: 6 },
  ingredientTag: { fontSize: 11, color: '#6b7280' },

  macroInputCard: {
    backgroundColor: 'white', borderRadius: 16, marginHorizontal: 20,
    marginBottom: 12, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  macroInputDesc: { fontSize: 13, color: '#9ca3af', marginBottom: 14 },
  macroInputGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  macroInputItem: { width: '47%' },
  macroInputLabel: { fontSize: 12, fontWeight: '600', marginBottom: 6 },
  macroInputRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, overflow: 'hidden',
  },
  macroInputField: {
    flex: 1, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 16, fontWeight: '600', color: '#111827',
  },
  macroInputUnit: {
    paddingHorizontal: 10, fontSize: 12,
    color: '#9ca3af', backgroundColor: '#f9fafb',
    paddingVertical: 10,
  },

  stickyFooter: {
    padding: 16,
    backgroundColor: 'white',
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  confirmBtn: {
    backgroundColor: '#10b981', borderRadius: 14, marginHorizontal: 20,
    paddingVertical: 16, alignItems: 'center',
  },
  confirmBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },
  editBtn: {
    borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 14, marginHorizontal: 20,
    paddingVertical: 14, alignItems: 'center',
  },
  editBtnText: { color: '#6b7280', fontSize: 14, fontWeight: '600' },
})