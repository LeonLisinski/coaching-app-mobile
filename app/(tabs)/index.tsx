import { supabase } from '@/lib/supabase'
import { useLanguage } from '@/lib/LanguageContext'
import { useClient } from '@/lib/ClientContext'
import { UnitLiftWordmark } from '@/lib/UnitLiftLogo'
import { useFocusEffect, useRouter } from 'expo-router'
import { BarChart2, ClipboardCheck, Dumbbell, Salad } from 'lucide-react-native'
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator, Dimensions, Modal, ScrollView,
  StyleSheet, Text, TouchableOpacity, View
} from 'react-native'
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

type Profile = { full_name: string; email: string }
type CheckinConfig = { checkin_day: number | null }
type TodayCheckin = { id: string } | null
type CheckinParam = { id: string; name: string; unit: string | null }
type ChartPoint = { label: string; value: number; date: string }

// Supabase builders are PromiseLike (thenable), not full Promises. Wrap every
// startup query with timeout + fallback so Home can never spin forever.
function withTimeoutFallback<T>(
  builder: PromiseLike<T>,
  fallback: T,
  ms = 12000,
): Promise<T> {
  const safe = (async () => {
    try { return await builder } catch { return fallback }
  })()
  return Promise.race([
    safe,
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms)),
  ])
}

// DAYS_SHORT is now derived from i18n inside the component
const { width } = Dimensions.get('window')
const CHART_W = width - 40 - 36 - 16 // screen - padding - yAxis - some margin
const CHART_H = 120

const getToday = () => {
  const now = new Date(Date.now() - 4 * 60 * 60 * 1000)
  return now.toISOString().split('T')[0]
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { t, lang } = useLanguage()
  const { clientData, profile: ctxProfile, checkinConfig: ctxCheckinConfig, checkinParams: ctxCheckinParams } = useClient()
  const DAYS_SHORT = t('days_short').split(',')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [checkinConfig, setCheckinConfig] = useState<CheckinConfig | null>(null)
  const [todayCheckin, setTodayCheckin] = useState<TodayCheckin>(null)
  const [hasTraining, setHasTraining] = useState(false)
  const [hasNutrition, setHasNutrition] = useState(false)
  const [hasTrainingDayPlan, setHasTrainingDayPlan] = useState(false)
  const [unreadMessages, setUnreadMessages] = useState(0)
  // Start without spinner if profile is already in context (pre-fetched by tabs layout)
  const [loading, setLoading] = useState(() => !ctxProfile)
  const [trainingPlanName, setTrainingPlanName] = useState<string | null>(null)
  const [nutritionPlanName, setNutritionPlanName] = useState<string | null>(null)
  const [checkinParams, setCheckinParams] = useState<CheckinParam[]>([])
  const [selectedParam, setSelectedParam] = useState<CheckinParam | null>(null)
  const [chartData, setChartData] = useState<ChartPoint[]>([])
  const [showParamPicker, setShowParamPicker] = useState(false)
  const [clientId, setClientId] = useState<string | null>(null)
  const [trainerId, setTrainerId] = useState<string | null>(null)

  const [isTrainingDay, setIsTrainingDay] = useState<boolean | null>(null)
  const [dailyLogId, setDailyLogId] = useState<string | null>(null)
  const [savingTrainingDay, setSavingTrainingDay] = useState(false)

  const today = getToday()

  // Re-run when clientData is populated (context may arrive after first render)
  useEffect(() => { fetchData() }, [clientData?.clientId])

  // Refresh unread count every time Home comes into focus (e.g. after visiting Chat)
  useFocusEffect(
    useCallback(() => {
      if (!clientId || !clientData?.userId) return
      supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .eq('read', false)
        .neq('sender_id', clientData.userId)
        .then(({ count }) => setUnreadMessages(count ?? 0))
    }, [clientId, clientData?.userId]),
  )

  const fetchData = async () => {
    const cId = clientData?.clientId
    const tId = clientData?.trainerId
    const uid = clientData?.userId
    if (!cId || !tId || !uid) { setLoading(false); return }

    setClientId(cId)
    setTrainerId(tId)

    // Apply context-cached static data instantly (no network needed)
    const cachedProfile = ctxProfile
    const cachedConfig = ctxCheckinConfig
    const numericParams = ctxCheckinParams.filter(p => p.type === 'number')

    if (cachedProfile) setProfile(cachedProfile)
    if (cachedConfig) setCheckinConfig(cachedConfig)
    if (numericParams.length > 0) {
      setCheckinParams(numericParams)
      setSelectedParam(numericParams[0])
    }

    try {
      // Fetch dynamic per-day data + fallback static data if context was empty.
      // Use maybeSingle() for queries that might legitimately return 0 rows —
      // .single() errors on 0 rows and would leave the UI in a stale state.
      const [
        checkinRes,
        wpRes,
        mpRes,
        unreadRes,
        dailyLogRes,
        profileRes,
        configRes,
        paramsRes,
      ] = await Promise.all([
        withTimeoutFallback(
          supabase.from('checkins').select('id').eq('client_id', cId).eq('date', today).maybeSingle() as PromiseLike<{ data: TodayCheckin }>,
          { data: null },
          12000,
        ),
        // maybeSingle: 0 rows (no plan) is valid, .single() would error+return null anyway
        // but maybeSingle is explicit and doesn't log a PostgREST error
        withTimeoutFallback(
          supabase.from('client_workout_plans')
            .select('id, workout_plans(name)')
            .eq('client_id', cId).eq('active', true).limit(1).maybeSingle() as PromiseLike<{ data: any }>,
          { data: null },
          12000,
        ),
        withTimeoutFallback(
          supabase.from('client_meal_plans')
            .select('id, plan_type, meal_plans(name)')
            .eq('client_id', cId).eq('active', true) as PromiseLike<{ data: any[] | null }>,
          { data: [] },
          12000,
        ),
        withTimeoutFallback(
          supabase.from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('client_id', cId).eq('read', false).neq('sender_id', uid) as PromiseLike<{ count: number | null }>,
          { count: 0 },
          12000,
        ),
        withTimeoutFallback(
          supabase.from('daily_logs')
            .select('id, is_training_day, values').eq('client_id', cId).eq('date', today).maybeSingle() as PromiseLike<{ data: any }>,
          { data: null },
          12000,
        ),
        // Fallback fetches — fire only when context cache is empty
        cachedProfile
          ? Promise.resolve({ data: null as typeof cachedProfile | null })
          : withTimeoutFallback(
              supabase.from('profiles').select('full_name, email').eq('id', uid).maybeSingle() as PromiseLike<{ data: typeof cachedProfile | null }>,
              { data: null },
              12000,
            ),
        cachedConfig
          ? Promise.resolve({ data: null as typeof cachedConfig | null })
          : withTimeoutFallback(
              supabase.from('checkin_config').select('checkin_day').eq('client_id', cId).maybeSingle() as PromiseLike<{ data: typeof cachedConfig | null }>,
              { data: null },
              12000,
            ),
        numericParams.length > 0
          ? Promise.resolve({ data: null as any })
          : withTimeoutFallback(
              supabase.from('checkin_parameters').select('id, name, unit').eq('trainer_id', tId).eq('type', 'number').order('order_index') as PromiseLike<{ data: any[] | null }>,
              { data: [] },
              12000,
            ),
      ])

      const checkinData = checkinRes.data
      const wpData = wpRes.data
      const mpData = mpRes.data
      const unreadCount = unreadRes.count
      const dailyLogData = dailyLogRes.data
      const profileFallback = profileRes.data
      const configFallback = configRes.data
      const paramsFallback = paramsRes.data

      if (!cachedProfile && profileFallback) setProfile(profileFallback)
      if (!cachedConfig && configFallback) setCheckinConfig(configFallback as any)

      setTodayCheckin(checkinData)
      setHasTraining(!!wpData?.id)
      setHasNutrition((mpData?.length ?? 0) > 0)

      const wpName = (wpData?.workout_plans as any)?.name ?? null
      if (wpName) setTrainingPlanName(wpName)

      const mpName = (mpData?.[0]?.meal_plans as any)?.name ?? null
      if (mpName) setNutritionPlanName(mpName)

      const hasTypedPlans = mpData?.some(
        (p: any) => p.plan_type === 'training_day' || p.plan_type === 'rest_day'
      ) ?? false
      setHasTrainingDayPlan(hasTypedPlans)

      if (dailyLogData) {
        setDailyLogId(dailyLogData.id)
        setIsTrainingDay(dailyLogData.is_training_day ?? null)
      }

      setUnreadMessages(unreadCount ?? 0)

      // Determine which params to use for chart (context or fallback)
      const finalParams = numericParams.length > 0 ? numericParams : (paramsFallback ?? [])
      if (finalParams.length > 0) {
        if (numericParams.length === 0) {
          setCheckinParams(finalParams)
          setSelectedParam(finalParams[0])
        }
        loadChartData(cId, finalParams[0]) // intentionally not awaited
      }
    } catch (e) {
      // Network error or unexpected rejection — UI shows defaults (Nema plana)
      // which is safe. User can pull-to-refresh or navigate away and back.
      console.warn('[home] fetchData error:', e)
    } finally {
      // Always clear spinner — no more infinite loading state
      setLoading(false)
    }
  }

  const handleTrainingDayAnswer = async (answer: boolean) => {
    if (!clientId || !trainerId) return
    setSavingTrainingDay(true)
    setIsTrainingDay(answer)

    if (dailyLogId) {
      await supabase.from('daily_logs').update({ is_training_day: answer }).eq('id', dailyLogId)
    } else {
      const { data } = await supabase.from('daily_logs').insert({
        client_id: clientId, trainer_id: trainerId,
        date: today, values: {}, is_training_day: answer,
      }).select('id').single()
      if (data) setDailyLogId(data.id)
    }

    setSavingTrainingDay(false)
  }

  const loadChartData = async (cId: string, param: CheckinParam) => {
    const localeTag = lang === 'hr' ? 'hr-HR' : 'en-US'
    const [{ data: dailyData }, { data: weeklyData }] = await Promise.all([
      supabase.from('daily_logs').select('date, values').eq('client_id', cId).order('date', { ascending: false }).limit(60),
      supabase.from('checkins').select('date, values').eq('client_id', cId).order('date', { ascending: false }).limit(60),
    ])

    const parseVal = (raw: unknown): number | null => {
      if (raw === undefined || raw === null || raw === '') return null
      const v = parseFloat(String(raw).replace(',', '.'))
      return Number.isFinite(v) ? v : null
    }

    type Row = { date: string; value: number; pri: number }
    const rows: Row[] = []
    for (const r of weeklyData || []) {
      const v = parseVal(r.values?.[param.id])
      if (v === null) continue
      rows.push({ date: r.date, value: v, pri: 0 })
    }
    for (const r of dailyData || []) {
      const v = parseVal(r.values?.[param.id])
      if (v === null) continue
      rows.push({ date: r.date, value: v, pri: 1 })
    }
    rows.sort((a, b) => a.date.localeCompare(b.date))

    const merged: ChartPoint[] = []
    let i = 0
    while (i < rows.length) {
      const d = rows[i].date
      let best = rows[i]
      let j = i + 1
      while (j < rows.length && rows[j].date === d) {
        if (rows[j].pri >= best.pri) best = rows[j]
        j++
      }
      merged.push({
        label: new Date(`${d}T12:00:00`).toLocaleDateString(localeTag, { day: '2-digit', month: '2-digit' }),
        value: best.value,
        date: d,
      })
      i = j
    }

    setChartData(merged.slice(-12))
  }

  const handleSelectParam = async (param: CheckinParam) => {
    setSelectedParam(param)
    if (clientId) await loadChartData(clientId, param)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.replace('/(auth)/login')
  }

  const getGreeting = () => {
    const h = new Date().getHours()
    if (h < 12) return t('greeting_morning')
    if (h < 18) return t('greeting_day')
    return t('greeting_evening')
  }

  const firstName = profile?.full_name?.split(' ')[0] || ''
  const todayDay = new Date().getDay()
  const isCheckinDay = checkinConfig?.checkin_day === todayDay

  // SVG chart helpers
  const chartMin = chartData.length > 0 ? Math.min(...chartData.map(d => d.value)) : 0
  const chartMax = chartData.length > 0 ? Math.max(...chartData.map(d => d.value)) : 1
  const chartRange = chartMax - chartMin || 1
  const PAD = { top: 12, bottom: 8, left: 0, right: 8 }
  const innerH = CHART_H - PAD.top - PAD.bottom
  const innerW = CHART_W - PAD.left - PAD.right

  const getX = (i: number) => {
    if (chartData.length === 1) return innerW / 2
    return PAD.left + (i / (chartData.length - 1)) * innerW
  }
  const getY = (v: number) => PAD.top + innerH - ((v - chartMin) / chartRange) * innerH

  // Build SVG path for area fill
  const buildAreaPath = () => {
    if (chartData.length < 2) return ''
    const points = chartData.map((d, i) => `${getX(i)},${getY(d.value)}`)
    return [
      `M ${getX(0)},${CHART_H - PAD.bottom}`,
      `L ${points[0]}`,
      ...chartData.slice(1).map((d, i) => `L ${getX(i + 1)},${getY(d.value)}`),
      `L ${getX(chartData.length - 1)},${CHART_H - PAD.bottom}`,
      'Z'
    ].join(' ')
  }

  const buildLinePath = () => {
    if (chartData.length < 2) return ''
    return chartData.map((d, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)},${getY(d.value)}`).join(' ')
  }

  if (loading) return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color="#6366f1" />
    </View>
  )

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

      {/* Header */}
      <View style={[styles.headerBg, { paddingTop: insets.top + 12 }]}>
        {/* UnitLift branding row */}
        <View style={styles.brandRow}>
          <View style={styles.brandLeft}>
            <UnitLiftWordmark height={20} color="rgba(255,255,255,0.92)" />
          </View>
          <TouchableOpacity onPress={() => router.push('/settings')} style={styles.settingsBtn} activeOpacity={0.7}>
            <Text style={styles.settingsIcon}>⚙</Text>
          </TouchableOpacity>
        </View>
        {/* Greeting row */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>{getGreeting()}</Text>
            <Text style={styles.name}>{firstName} 👋</Text>
          </View>
        </View>
        {isCheckinDay && !todayCheckin ? (
          <TouchableOpacity style={styles.checkinAlert} onPress={() => router.push('/(tabs)/5-checkin')}>
            <View style={styles.checkinAlertLeft}>
              <ClipboardCheck size={20} color="white" strokeWidth={2} />
              <View>
                <Text style={styles.checkinAlertTitle}>{t('home_checkin_alert_title')}</Text>
                <Text style={styles.checkinAlertSub}>{t('home_checkin_alert_sub')}</Text>
              </View>
            </View>
            <Text style={styles.checkinAlertArrow}>›</Text>
          </TouchableOpacity>
        ) : todayCheckin ? (
          <View style={styles.checkinDone}>
            <Text style={styles.checkinDoneText}>{t('home_checkin_done')}</Text>
          </View>
        ) : null}
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <TouchableOpacity style={styles.statCard} onPress={() => router.push('/(tabs)/1-training')}>
          <Dumbbell size={16} color="#6366f1" strokeWidth={2} />
          <Text style={styles.statLabel}>{t('tab_training')}</Text>
          <Text style={[styles.statValue, !hasTraining && styles.statValueOff]} numberOfLines={1}>
            {hasTraining ? (trainingPlanName ?? t('active')) : t('none')}
          </Text>
        </TouchableOpacity>
        <View style={styles.statDivider} />
        <TouchableOpacity style={styles.statCard} onPress={() => router.push('/(tabs)/2-nutrition')}>
          <Salad size={16} color="#10b981" strokeWidth={2} />
          <Text style={styles.statLabel}>{t('tab_nutrition')}</Text>
          <Text style={[styles.statValue, !hasNutrition && styles.statValueOff]} numberOfLines={1}>
            {hasNutrition ? (nutritionPlanName ?? t('active')) : t('none')}
          </Text>
        </TouchableOpacity>
        <View style={styles.statDivider} />
        <TouchableOpacity style={styles.statCard} onPress={() => router.push('/(tabs)/5-checkin')}>
          <BarChart2 size={16} color="#f59e0b" strokeWidth={2} />
          <Text style={styles.statLabel}>{t('home_checkin_day')}</Text>
          <Text style={styles.statValue}>
            {checkinConfig?.checkin_day != null ? DAYS_SHORT[checkinConfig.checkin_day] : 'N/A'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Treniraš danas? */}
      {(hasTrainingDayPlan || hasTraining) && (
        <View style={styles.trainingDayCard}>
          {/* Top row: icon + title + hint/answer */}
          <View style={styles.trainingDayTop}>
            <View style={styles.trainingDayIconBox}>
              <Dumbbell size={16} color="#3b82f6" strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.trainingDayTitle}>{t('home_training_today')}</Text>
              {isTrainingDay !== null ? (
                <Text style={styles.trainingDayAnswer} numberOfLines={1}>
                  {isTrainingDay ? t('home_training_day_yes') : t('home_training_day_no')}
                </Text>
              ) : (
                <Text style={styles.trainingDayHint} numberOfLines={1}>{t('home_training_hint')}</Text>
              )}
            </View>
          </View>
          {/* Bottom row: buttons */}
          <View style={styles.trainingDayBtns}>
            <TouchableOpacity
              style={[styles.trainingBtn, isTrainingDay === true && styles.trainingBtnActiveYes]}
              onPress={() => handleTrainingDayAnswer(true)}
              disabled={savingTrainingDay}
            >
              <Text style={[styles.trainingBtnText, isTrainingDay === true && styles.trainingBtnTextActive]}>{t('yes')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.trainingBtn, isTrainingDay === false && styles.trainingBtnActiveNo]}
              onPress={() => handleTrainingDayAnswer(false)}
              disabled={savingTrainingDay}
            >
              <Text style={[styles.trainingBtnText, isTrainingDay === false && styles.trainingBtnTextActive]}>{t('no')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Quick actions */}
      <Text style={styles.sectionTitle}>{t('home_quick_access')}</Text>
      <View style={styles.grid}>

        <TouchableOpacity style={[styles.quickCard, { backgroundColor: '#3b82f6' }]} onPress={() => router.push('/(tabs)/1-training')} activeOpacity={0.85}>
          <Text style={styles.quickCardEmoji}>🏋️</Text>
          <Text style={styles.quickCardTitle}>{t('home_training')}</Text>
          <Text style={styles.quickCardSub}>{hasTraining ? (trainingPlanName ?? t('home_plan_view')) : t('home_plan_none')}</Text>
          <Text style={styles.quickCardArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.quickCard, { backgroundColor: '#22c55e' }]} onPress={() => router.push('/(tabs)/2-nutrition')} activeOpacity={0.85}>
          <Text style={styles.quickCardEmoji}>🥗</Text>
          <Text style={styles.quickCardTitle}>{t('home_nutrition')}</Text>
          <Text style={styles.quickCardSub}>{hasNutrition ? (nutritionPlanName ?? t('home_plan_view')) : t('home_plan_none')}</Text>
          <Text style={styles.quickCardArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.quickCard, { backgroundColor: '#8b5cf6' }]} onPress={() => router.push('/(tabs)/4-chat')} activeOpacity={0.85}>
          <Text style={styles.quickCardEmoji}>💬</Text>
          <Text style={styles.quickCardTitle}>{t('home_chat')}</Text>
          <Text style={styles.quickCardSub}>{unreadMessages > 0 ? `${unreadMessages} ${t('home_chat_new')}` : t('home_chat_messages')}</Text>
          <Text style={styles.quickCardArrow}>›</Text>
          {unreadMessages > 0 && (
            <View style={styles.unreadBadge}><Text style={styles.unreadBadgeText}>{unreadMessages}</Text></View>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={[styles.quickCard, { backgroundColor: '#f97316' }]} onPress={() => router.push('/(tabs)/5-checkin')} activeOpacity={0.85}>
          <Text style={styles.quickCardEmoji}>📋</Text>
          <Text style={styles.quickCardTitle}>{t('home_checkin')}</Text>
          <Text style={styles.quickCardSub}>{t('home_checkin_sub')}</Text>
          <Text style={styles.quickCardArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.quickCard, { backgroundColor: '#6366f1' }]} onPress={() => router.push('/package')} activeOpacity={0.85}>
          <Text style={styles.quickCardEmoji}>📦</Text>
          <Text style={styles.quickCardTitle}>{t('home_package')}</Text>
          <Text style={styles.quickCardSub}>{t('home_package_sub')}</Text>
          <Text style={styles.quickCardArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.quickCard, { backgroundColor: '#64748b' }]} onPress={() => router.push('/timeline')} activeOpacity={0.85}>
          <Text style={styles.quickCardEmoji}>📅</Text>
          <Text style={styles.quickCardTitle}>{t('home_history')}</Text>
          <Text style={styles.quickCardSub}>{t('home_history_sub')}</Text>
          <Text style={styles.quickCardArrow}>›</Text>
        </TouchableOpacity>

      </View>

      {/* Progress chart */}
      {checkinParams.length > 0 && (
        <View style={styles.chartCard}>
          <View style={styles.chartTitleRow}>
            <Text style={styles.chartTitle}>{t('home_progress')}</Text>
            <TouchableOpacity onPress={() => router.push('/metrics')} activeOpacity={0.75}>
              <Text style={styles.allMetricsLink}>{t('home_all_metrics')}</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.paramSelector} onPress={() => setShowParamPicker(true)}>
            <Text style={styles.paramSelectorText}>{selectedParam?.name || 'Odaberi'}</Text>
            {selectedParam?.unit && <Text style={styles.paramSelectorUnit}>{selectedParam.unit}</Text>}
            <Text style={styles.paramSelectorChevron}>▾</Text>
          </TouchableOpacity>

          {chartData.length === 0 ? (
            <View style={styles.chartEmpty}>
              <Text style={styles.chartEmptyText}>{t('home_chart_no_data')}</Text>
            </View>
          ) : (
            <View>
              {/* Y axis labels + SVG chart */}
              <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                {/* Y axis */}
                <View style={{ width: 36, height: CHART_H, justifyContent: 'space-between', paddingVertical: PAD.top, alignItems: 'flex-end', paddingRight: 6 }}>
                  <Text style={styles.yLabel}>{chartMax % 1 === 0 ? chartMax : chartMax.toFixed(1)}</Text>
                  <Text style={styles.yLabel}>{(((chartMax + chartMin) / 2) % 1 === 0 ? (chartMax + chartMin) / 2 : ((chartMax + chartMin) / 2).toFixed(1))}</Text>
                  <Text style={styles.yLabel}>{chartMin % 1 === 0 ? chartMin : chartMin.toFixed(1)}</Text>
                </View>

                {/* SVG */}
                <Svg width={CHART_W} height={CHART_H}>
                  <Defs>
                    <LinearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                      <Stop offset="0%" stopColor="#3b82f6" stopOpacity="0.18" />
                      <Stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                    </LinearGradient>
                  </Defs>

                  {/* Grid lines */}
                  {[0, 0.5, 1].map((f, i) => (
                    <Line
                      key={i}
                      x1={0} y1={PAD.top + f * innerH}
                      x2={CHART_W} y2={PAD.top + f * innerH}
                      stroke="#f3f4f6" strokeWidth="1"
                    />
                  ))}

                  {/* Area fill */}
                  {chartData.length > 1 && (
                    <Path d={buildAreaPath()} fill="url(#areaGrad)" />
                  )}

                  {/* Line */}
                  {chartData.length > 1 && (
                    <Path
                      d={buildLinePath()}
                      fill="none" stroke="#3b82f6" strokeWidth="2.5"
                      strokeLinejoin="round" strokeLinecap="round"
                    />
                  )}

                  {/* Dots */}
                  {chartData.map((d, i) => (
                    <Circle
                      key={i}
                      cx={getX(i)} cy={getY(d.value)}
                      r="5" fill="#3b82f6" stroke="white" strokeWidth="2"
                    />
                  ))}
                </Svg>
              </View>

              {/* X axis labels */}
              <View style={{ flexDirection: 'row', paddingLeft: 36, paddingTop: 4 }}>
                {chartData.map((p, i) => {
                  const show = chartData.length <= 6 || i === 0 || i === chartData.length - 1 || i % Math.ceil(chartData.length / 4) === 0
                  return (
                    <Text key={i} style={[styles.xLabel, { flex: 1, opacity: show ? 1 : 0 }]}>
                      {p.label}
                    </Text>
                  )
                })}
              </View>
            </View>
          )}

          {chartData.length >= 2 && (() => {
            // Promjena = razlika zadnje i prve točke u prikazanom rasponu (ne zadnje dvije — inače 0 ako je zadnji segment ravan)
            const firstPt = chartData[0]
            const last = chartData[chartData.length - 1]
            const diff = last.value - firstPt.value
            const pct =
              Math.abs(firstPt.value) >= 1e-9
                ? ((diff / firstPt.value) * 100).toFixed(1)
                : null
            const diffRounded = Math.abs(diff) < 1e-9 ? 0 : diff
            const diffDisp = Number.isInteger(diffRounded) ? String(diffRounded) : diffRounded.toFixed(1)
            return (
              <View style={styles.chartStats}>
                <View style={styles.chartStatItem}>
                  <Text style={styles.chartStatLabel}>{t('home_stat_last')}</Text>
                  <Text style={styles.chartStatValue}>{last.value} {selectedParam?.unit || ''}</Text>
                </View>
                <View style={styles.chartStatItem}>
                  <Text style={styles.chartStatLabel}>{t('home_chart_change')}</Text>
                  <Text style={[styles.chartStatValue, { color: diffRounded < 0 ? '#22c55e' : diffRounded > 0 ? '#ef4444' : '#6b7280' }]}>
                    {diffRounded > 0 ? '+' : ''}{diffDisp}{pct != null ? ` (${pct}%)` : ''}
                  </Text>
                </View>
                <View style={styles.chartStatItem}>
                  <Text style={styles.chartStatLabel}>{t('home_chart_entries')}</Text>
                  <Text style={styles.chartStatValue}>{chartData.length}</Text>
                </View>
              </View>
            )
          })()}
        </View>
      )}

      {/* Param picker modal */}
      <Modal visible={showParamPicker} animationType="slide" transparent onRequestClose={() => setShowParamPicker(false)}>
        <TouchableOpacity style={pickerStyles.overlay} activeOpacity={1} onPress={() => setShowParamPicker(false)}>
          <View style={pickerStyles.sheet}>
            <View style={pickerStyles.handle} />
            <Text style={pickerStyles.title}>Odaberi parametar</Text>
            {checkinParams.map(p => (
              <TouchableOpacity
                key={p.id}
                style={[pickerStyles.option, selectedParam?.id === p.id && pickerStyles.optionActive]}
                onPress={() => { handleSelectParam(p); setShowParamPicker(false) }}
              >
                <Text style={[pickerStyles.optionText, selectedParam?.id === p.id && pickerStyles.optionTextActive]}>{p.name}</Text>
                {p.unit && <Text style={pickerStyles.optionUnit}>{p.unit}</Text>}
                {selectedParam?.id === p.id && <Text style={pickerStyles.check}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { paddingBottom: 48 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f3f4f6' },

  headerBg: {
    backgroundColor: '#1d4ed8', paddingHorizontal: 24,
    paddingBottom: 28, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, marginBottom: 20,
  },
  brandRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 18,
  },
  brandLeft: { flexDirection: 'row', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'flex-start', alignItems: 'flex-start', marginBottom: 22 },
  greeting: { fontSize: 13, color: 'rgba(255,255,255,0.65)', fontWeight: '500', letterSpacing: 0.3 },
  name: { fontSize: 28, fontWeight: '800', color: 'white', marginTop: 3, letterSpacing: -0.5 },
  settingsBtn: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  settingsIcon: { fontSize: 18, color: 'rgba(255,255,255,0.85)' },

  checkinAlert: {
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 14, padding: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
  },
  checkinAlertLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkinAlertTitle: { fontSize: 14, fontWeight: '700', color: 'white' },
  checkinAlertSub: { fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  checkinAlertArrow: { fontSize: 24, color: 'rgba(255,255,255,0.65)', fontWeight: '300' },
  checkinDone: { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 12, padding: 11, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  checkinDoneText: { color: 'rgba(255,255,255,0.85)', fontWeight: '600', fontSize: 13 },

  statsRow: {
    flexDirection: 'row', backgroundColor: 'white', borderRadius: 16,
    marginHorizontal: 20, marginBottom: 16, paddingVertical: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  statCard: { flex: 1, alignItems: 'center', gap: 6 },
  statDivider: { width: 1, backgroundColor: '#f3f4f6', marginVertical: 6 },
  statLabel: { fontSize: 11, color: '#9ca3af', fontWeight: '500' },
  statValue: { fontSize: 12, fontWeight: '700', color: '#111827', textAlign: 'center', paddingHorizontal: 4 },
  statValueOff: { color: '#d1d5db' },

  trainingDayCard: {
    backgroundColor: 'white', borderRadius: 16, marginHorizontal: 20, marginBottom: 16,
    paddingHorizontal: 16, paddingVertical: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
    gap: 12,
  },
  trainingDayTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  trainingDayLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  trainingDayIconBox: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: '#eff6ff',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  trainingDayIconBoxYes: { backgroundColor: '#eff6ff' },
  trainingDayIconBoxNo:  { backgroundColor: '#f5f3ff' },
  trainingDayTitle: { fontSize: 14, fontWeight: '700', color: '#111827' },
  trainingDayAnswer: { fontSize: 12, color: '#3b82f6', marginTop: 2, fontWeight: '500' },
  trainingDayHint: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  trainingDayBtns: { flexDirection: 'row', gap: 8 },
  trainingBtn: { flex: 1, paddingVertical: 9, borderRadius: 12, borderWidth: 1.5, borderColor: '#e5e7eb', alignItems: 'center' },
  trainingBtnActiveYes: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
  trainingBtnActiveNo: { backgroundColor: '#8b5cf6', borderColor: '#8b5cf6' },
  trainingBtnText: { fontSize: 13, fontWeight: '700', color: '#6b7280' },
  trainingBtnTextActive: { color: 'white' },

  sectionTitle: { fontSize: 11, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 14, marginHorizontal: 20 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 20, marginBottom: 24 },
  quickCard: {
    width: '47%', borderRadius: 18, padding: 16, position: 'relative',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.12, shadowRadius: 10, elevation: 4,
  },
  quickCardEmoji: { fontSize: 22, marginBottom: 10 },
  quickCardTitle: { fontSize: 14, fontWeight: '700', color: 'white', marginBottom: 3 },
  quickCardSub: { fontSize: 12, color: 'rgba(255,255,255,0.75)', fontWeight: '500' },
  quickCardArrow: { position: 'absolute', right: 14, bottom: 14, fontSize: 18, color: 'rgba(255,255,255,0.5)', fontWeight: '300' },
  unreadBadge: { position: 'absolute', top: 10, right: 10, backgroundColor: '#ef4444', borderRadius: 99, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)' },
  unreadBadgeText: { color: 'white', fontSize: 11, fontWeight: '700' },

  chartCard: {
    backgroundColor: 'white', borderRadius: 20, marginHorizontal: 20,
    padding: 18, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  chartTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  chartTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  allMetricsLink: { fontSize: 13, color: '#4f46e5', fontWeight: '600' },
  chartEmpty: { height: 100, alignItems: 'center', justifyContent: 'center' },
  chartEmptyText: { fontSize: 13, color: '#9ca3af', textAlign: 'center' },
  yLabel: { fontSize: 10, color: '#9ca3af' },
  xLabel: { fontSize: 10, color: '#9ca3af', textAlign: 'center' },
  chartStats: { flexDirection: 'row', marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  chartStatItem: { flex: 1, alignItems: 'center' },
  chartStatLabel: { fontSize: 11, color: '#9ca3af', marginBottom: 4 },
  chartStatValue: { fontSize: 14, fontWeight: '700', color: '#111827' },

  paramSelector: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#f9fafb', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: '#e5e7eb', marginBottom: 16, alignSelf: 'flex-start',
  },
  paramSelectorText: { fontSize: 14, fontWeight: '600', color: '#111827' },
  paramSelectorUnit: { fontSize: 12, color: '#9ca3af' },
  paramSelectorChevron: { fontSize: 12, color: '#9ca3af' },
})

const pickerStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end' },
  sheet: { backgroundColor: 'white', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40 },
  handle: { width: 36, height: 4, backgroundColor: '#e5e7eb', borderRadius: 99, alignSelf: 'center', marginBottom: 16 },
  title: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 12 },
  option: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#f9fafb', gap: 8 },
  optionActive: { backgroundColor: '#eff6ff', borderRadius: 10, paddingHorizontal: 10, marginHorizontal: -10 },
  optionText: { flex: 1, fontSize: 15, color: '#374151', fontWeight: '500' },
  optionTextActive: { color: '#3b82f6', fontWeight: '700' },
  optionUnit: { fontSize: 12, color: '#9ca3af', backgroundColor: '#f3f4f6', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99 },
  check: { fontSize: 14, color: '#3b82f6', fontWeight: '700' },
})
