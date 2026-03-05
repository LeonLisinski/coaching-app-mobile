import { supabase } from '@/lib/supabase'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator, Dimensions, Modal, ScrollView,
  StyleSheet, Text, TouchableOpacity, View
} from 'react-native'
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg'

type Profile = { full_name: string; email: string }
type CheckinConfig = { checkin_day: number | null }
type TodayCheckin = { id: string } | null
type CheckinParam = { id: string; name: string; unit: string | null }
type ChartPoint = { label: string; value: number; date: string }

const DAYS_SHORT = ['Ned', 'Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub']
const { width } = Dimensions.get('window')
const CHART_W = width - 40 - 36 - 16 // screen - padding - yAxis - some margin
const CHART_H = 120

const getToday = () => {
  const now = new Date(Date.now() - 4 * 60 * 60 * 1000)
  return now.toISOString().split('T')[0]
}

export default function HomeScreen() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [checkinConfig, setCheckinConfig] = useState<CheckinConfig | null>(null)
  const [todayCheckin, setTodayCheckin] = useState<TodayCheckin>(null)
  const [hasTraining, setHasTraining] = useState(false)
  const [hasNutrition, setHasNutrition] = useState(false)
  const [hasTrainingDayPlan, setHasTrainingDayPlan] = useState(false)
  const [unreadMessages, setUnreadMessages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [nextTraining, setNextTraining] = useState<string | null>(null)
  const [nextMeal, setNextMeal] = useState<string | null>(null)
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

  useEffect(() => { fetchData() }, [])

  const fetchData = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [{ data: profileData }, { data: cData }] = await Promise.all([
      supabase.from('profiles').select('full_name, email').eq('id', user.id).single(),
      supabase.from('clients').select('id, trainer_id').eq('user_id', user.id).single(),
    ])

    if (profileData) setProfile(profileData)
    if (!cData) return setLoading(false)

    const cId = cData.id
    const tId = cData.trainer_id
    setClientId(cId)
    setTrainerId(tId)

    const [
      { data: configData }, { data: checkinData },
      { data: trainingData }, { data: nutritionData },
      { data: messagesData }, { data: paramsData },
      { data: dailyLogData }, { data: mealPlansData },
    ] = await Promise.all([
      supabase.from('checkin_config').select('checkin_day').eq('client_id', cId).single(),
      supabase.from('checkins').select('id').eq('client_id', cId).eq('date', today).single(),
      supabase.from('client_workout_plans').select('id').eq('client_id', cId).eq('active', true).limit(1),
      supabase.from('client_meal_plans').select('id').eq('client_id', cId).eq('active', true).limit(1),
      supabase.from('messages').select('id').eq('client_id', cId).eq('read', false).neq('sender_id', user.id),
      supabase.from('checkin_parameters').select('id, name, unit').eq('trainer_id', tId).eq('type', 'number').order('order_index'),
      supabase.from('daily_logs').select('id, is_training_day, values').eq('client_id', cId).eq('date', today).single(),
      supabase.from('client_meal_plans').select('plan_type').eq('client_id', cId).eq('active', true),
    ])

    if (configData) setCheckinConfig(configData)
    setTodayCheckin(checkinData)
    setHasTraining((trainingData?.length ?? 0) > 0)
    setHasNutrition((nutritionData?.length ?? 0) > 0)

    const hasTypedPlans = mealPlansData?.some(
      p => p.plan_type === 'training_day' || p.plan_type === 'rest_day'
    ) ?? false
    setHasTrainingDayPlan(hasTypedPlans)

    if (dailyLogData) {
      setDailyLogId(dailyLogData.id)
      setIsTrainingDay(dailyLogData.is_training_day ?? null)
    }

    setUnreadMessages(messagesData?.length ?? 0)

    const { data: wpData } = await supabase
      .from('client_workout_plans').select('workout_plan_id')
      .eq('client_id', cId).eq('active', true).limit(1).single()
    if (wpData?.workout_plan_id) {
      const { data: planData } = await supabase
        .from('workout_plans').select('days').eq('id', wpData.workout_plan_id).single()
      if (planData?.days) {
        const weekStart = (() => {
          const now = new Date(); const day = now.getDay()
          const diff = day === 0 ? -6 : 1 - day
          const mon = new Date(now); mon.setDate(now.getDate() + diff); mon.setHours(0,0,0,0)
          return mon.toISOString().split('T')[0]
        })()
        const { data: weekLogs } = await supabase.from('workout_logs')
          .select('day_name').eq('client_id', cId).gte('date', weekStart)
        const doneNames = new Set(weekLogs?.map((l: any) => l.day_name) || [])
        const next = planData.days.find((d: any) => !doneNames.has(d.name)) || planData.days[0]
        setNextTraining(next?.name || null)
      }
    }

    const trainingAnswered = dailyLogData?.is_training_day ?? null
    await loadNextMeal(cId, hasTypedPlans, trainingAnswered)

    if (paramsData && paramsData.length > 0) {
      setCheckinParams(paramsData)
      setSelectedParam(paramsData[0])
      await loadChartData(cId, paramsData[0])
    }

    setLoading(false)
  }

  const loadNextMeal = async (cId: string, hasTypedPlans: boolean, isTraining: boolean | null) => {
    const { data: allPlans } = await supabase
      .from('client_meal_plans').select('meal_plan_id, plan_type')
      .eq('client_id', cId).eq('active', true)
    if (!allPlans || allPlans.length === 0) return

    let targetPlan = allPlans[0]
    if (hasTypedPlans && isTraining !== null) {
      const wantedType = isTraining ? 'training_day' : 'rest_day'
      const typed = allPlans.find(p => p.plan_type === wantedType)
      if (typed) targetPlan = typed
    }

    const { data: mpData } = await supabase
      .from('meal_plans').select('meals').eq('id', targetPlan.meal_plan_id).single()
    if (!mpData?.meals?.length) return

    const meals: any[] = mpData.meals
    const now = new Date()
    const currentMinutes = now.getHours() * 60 + now.getMinutes()
    const withTime = meals.filter((m: any) => m.time)
    if (withTime.length > 0) {
      const toMin = (t: string) => { const [h, mm] = t.split(':').map(Number); return h * 60 + mm }
      const sorted = [...withTime].sort((a, b) =>
        (toMin(a.time) - currentMinutes + 1440) % 1440 - (toMin(b.time) - currentMinutes + 1440) % 1440
      )
      setNextMeal(sorted[0]?.name || meals[0]?.name || null)
    } else {
      setNextMeal(meals[0]?.name || null)
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

    await loadNextMeal(clientId, hasTrainingDayPlan, answer)
    setSavingTrainingDay(false)
  }

  const loadChartData = async (cId: string, param: CheckinParam) => {
    const [{ data: dailyData }, { data: weeklyData }] = await Promise.all([
      supabase.from('daily_logs').select('date, values').eq('client_id', cId).order('date', { ascending: true }).limit(20),
      supabase.from('checkins').select('date, values').eq('client_id', cId).order('date', { ascending: true }).limit(20),
    ])
    const toPoints = (rows: any[] | null): ChartPoint[] =>
      (rows || [])
        .filter(r => r.values?.[param.id] !== undefined && r.values?.[param.id] !== null && r.values?.[param.id] !== '')
        .map(r => ({
          label: new Date(r.date).toLocaleDateString('hr', { day: '2-digit', month: '2-digit' }),
          value: parseFloat(String(r.values[param.id]).replace(',', '.')),
          date: r.date,
        }))
        .filter(p => !isNaN(p.value))
    const dailyPoints = toPoints(dailyData)
    const weeklyPoints = toPoints(weeklyData)
    setChartData((dailyPoints.length >= weeklyPoints.length ? dailyPoints : weeklyPoints).slice(-12))
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
    if (h < 12) return 'Dobro jutro'
    if (h < 18) return 'Dobar dan'
    return 'Dobra večer'
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
      <View style={styles.headerBg}>
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>{getGreeting()}</Text>
            <Text style={styles.name}>{firstName} 👋</Text>
          </View>
          <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
            <Text style={styles.logoutText}>Odjava</Text>
          </TouchableOpacity>
        </View>
        {isCheckinDay && !todayCheckin ? (
          <TouchableOpacity style={styles.checkinAlert} onPress={() => router.push('/(tabs)/5-checkin')}>
            <View style={styles.checkinAlertLeft}>
              <Text style={styles.checkinAlertEmoji}>📋</Text>
              <View>
                <Text style={styles.checkinAlertTitle}>Check-in te čeka!</Text>
                <Text style={styles.checkinAlertSub}>Danas je tvoj dan — pošalji sada</Text>
              </View>
            </View>
            <Text style={styles.checkinAlertArrow}>→</Text>
          </TouchableOpacity>
        ) : todayCheckin ? (
          <View style={styles.checkinDone}>
            <Text style={styles.checkinDoneText}>✓ Današnji check-in poslan</Text>
          </View>
        ) : null}
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <TouchableOpacity style={styles.statCard} onPress={() => router.push('/(tabs)/1-training')}>
          <Text style={styles.statEmoji}>🏋️</Text>
          <Text style={styles.statLabel}>Trening</Text>
          <Text style={[styles.statValue, !hasTraining && styles.statValueOff]} numberOfLines={1}>
            {hasTraining && nextTraining ? nextTraining : hasTraining ? 'Aktivan' : 'Nema'}
          </Text>
        </TouchableOpacity>
        <View style={styles.statDivider} />
        <TouchableOpacity style={styles.statCard} onPress={() => router.push('/(tabs)/2-nutrition')}>
          <Text style={styles.statEmoji}>🥗</Text>
          <Text style={styles.statLabel}>Prehrana</Text>
          <Text style={[styles.statValue, !hasNutrition && styles.statValueOff]} numberOfLines={1}>
            {hasNutrition && nextMeal ? nextMeal : hasNutrition ? 'Aktivan' : 'Nema'}
          </Text>
        </TouchableOpacity>
        <View style={styles.statDivider} />
        <TouchableOpacity style={styles.statCard} onPress={() => router.push('/(tabs)/5-checkin')}>
          <Text style={styles.statEmoji}>📊</Text>
          <Text style={styles.statLabel}>Check-in</Text>
          <Text style={styles.statValue}>
            {checkinConfig?.checkin_day != null ? DAYS_SHORT[checkinConfig.checkin_day] : 'N/A'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Treniraš danas? */}
      {(hasTrainingDayPlan || hasTraining) && (
        <View style={styles.trainingDayCard}>
          <View style={styles.trainingDayLeft}>
            <Text style={styles.trainingDayEmoji}>
              {isTrainingDay === true ? '💪' : isTrainingDay === false ? '😌' : '❓'}
            </Text>
            <View>
              <Text style={styles.trainingDayTitle}>Treniraš danas?</Text>
              {isTrainingDay !== null ? (
                <Text style={styles.trainingDayAnswer}>
                  {isTrainingDay ? 'Da — plan prehrane za trening' : 'Ne — plan prehrane za odmor'}
                </Text>
              ) : (
                <Text style={styles.trainingDayHint}>Odgovori da vidimo pravi plan prehrane</Text>
              )}
            </View>
          </View>
          <View style={styles.trainingDayBtns}>
            <TouchableOpacity
              style={[styles.trainingBtn, isTrainingDay === true && styles.trainingBtnActiveYes]}
              onPress={() => handleTrainingDayAnswer(true)}
              disabled={savingTrainingDay}
            >
              <Text style={[styles.trainingBtnText, isTrainingDay === true && styles.trainingBtnTextActive]}>Da</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.trainingBtn, isTrainingDay === false && styles.trainingBtnActiveNo]}
              onPress={() => handleTrainingDayAnswer(false)}
              disabled={savingTrainingDay}
            >
              <Text style={[styles.trainingBtnText, isTrainingDay === false && styles.trainingBtnTextActive]}>Ne</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Quick actions */}
      <Text style={styles.sectionTitle}>Brzi pristup</Text>
      <View style={styles.grid}>
        <TouchableOpacity style={[styles.quickCard, styles.quickCardBlue]} onPress={() => router.push('/(tabs)/1-training')} activeOpacity={0.85}>
          <Text style={styles.quickCardEmoji}>🏋️</Text>
          <Text style={styles.quickCardTitle}>Trening</Text>
          <Text style={styles.quickCardSub}>{hasTraining ? 'Pregled plana →' : 'Nema plana'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.quickCard, styles.quickCardGreen]} onPress={() => router.push('/(tabs)/2-nutrition')} activeOpacity={0.85}>
          <Text style={styles.quickCardEmoji}>🥗</Text>
          <Text style={styles.quickCardTitle}>Prehrana</Text>
          <Text style={styles.quickCardSub}>{hasNutrition ? 'Pregled plana →' : 'Nema plana'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.quickCard, styles.quickCardPurple]} onPress={() => router.push('/(tabs)/4-chat')} activeOpacity={0.85}>
          <Text style={styles.quickCardEmoji}>💬</Text>
          <Text style={styles.quickCardTitle}>Chat</Text>
          <Text style={styles.quickCardSub}>{unreadMessages > 0 ? `${unreadMessages} novih →` : 'Poruke →'}</Text>
          {unreadMessages > 0 && (
            <View style={styles.unreadBadge}><Text style={styles.unreadBadgeText}>{unreadMessages}</Text></View>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={[styles.quickCard, styles.quickCardOrange]} onPress={() => router.push('/(tabs)/5-checkin')} activeOpacity={0.85}>
          <Text style={styles.quickCardEmoji}>📊</Text>
          <Text style={styles.quickCardTitle}>Check-in</Text>
          <Text style={styles.quickCardSub}>Unesi podatke →</Text>
        </TouchableOpacity>
      </View>

      {/* Progress chart */}
      {checkinParams.length > 0 && (
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>Napredak</Text>
          <TouchableOpacity style={styles.paramSelector} onPress={() => setShowParamPicker(true)}>
            <Text style={styles.paramSelectorText}>{selectedParam?.name || 'Odaberi'}</Text>
            {selectedParam?.unit && <Text style={styles.paramSelectorUnit}>{selectedParam.unit}</Text>}
            <Text style={styles.paramSelectorChevron}>▾</Text>
          </TouchableOpacity>

          {chartData.length === 0 ? (
            <View style={styles.chartEmpty}>
              <Text style={styles.chartEmptyText}>Nema podataka za ovaj parametar</Text>
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
            const last = chartData[chartData.length - 1]
            const prev = chartData[chartData.length - 2]
            const diff = last.value - prev.value
            const pct = prev.value !== 0 ? ((diff / prev.value) * 100).toFixed(1) : '0'
            return (
              <View style={styles.chartStats}>
                <View style={styles.chartStatItem}>
                  <Text style={styles.chartStatLabel}>Trenutno</Text>
                  <Text style={styles.chartStatValue}>{last.value} {selectedParam?.unit || ''}</Text>
                </View>
                <View style={styles.chartStatItem}>
                  <Text style={styles.chartStatLabel}>Promjena</Text>
                  <Text style={[styles.chartStatValue, { color: diff < 0 ? '#22c55e' : diff > 0 ? '#ef4444' : '#6b7280' }]}>
                    {diff > 0 ? '+' : ''}{diff.toFixed(1)} ({pct}%)
                  </Text>
                </View>
                <View style={styles.chartStatItem}>
                  <Text style={styles.chartStatLabel}>Unosa</Text>
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
    backgroundColor: '#1e1b4b', paddingTop: 56, paddingHorizontal: 20,
    paddingBottom: 24, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, marginBottom: 16,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  greeting: { fontSize: 14, color: '#a5b4fc', fontWeight: '500' },
  name: { fontSize: 28, fontWeight: '800', color: 'white', marginTop: 2 },
  logoutBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 8 },
  logoutText: { fontSize: 13, color: '#a5b4fc' },

  checkinAlert: {
    backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 14, padding: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  checkinAlertLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkinAlertEmoji: { fontSize: 28 },
  checkinAlertTitle: { fontSize: 15, fontWeight: '700', color: 'white' },
  checkinAlertSub: { fontSize: 12, color: '#a5b4fc', marginTop: 2 },
  checkinAlertArrow: { fontSize: 20, color: 'white' },
  checkinDone: { backgroundColor: 'rgba(34,197,94,0.2)', borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(34,197,94,0.3)' },
  checkinDoneText: { color: '#86efac', fontWeight: '600', fontSize: 14 },

  statsRow: {
    flexDirection: 'row', backgroundColor: 'white', borderRadius: 16,
    marginHorizontal: 20, marginBottom: 16, paddingVertical: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  statCard: { flex: 1, alignItems: 'center', gap: 4 },
  statDivider: { width: 1, backgroundColor: '#f3f4f6', marginVertical: 4 },
  statEmoji: { fontSize: 22 },
  statLabel: { fontSize: 11, color: '#9ca3af', fontWeight: '500' },
  statValue: { fontSize: 12, fontWeight: '700', color: '#111827', textAlign: 'center', paddingHorizontal: 4 },
  statValueOff: { color: '#d1d5db' },

  trainingDayCard: {
    backgroundColor: 'white', borderRadius: 16, marginHorizontal: 20, marginBottom: 16,
    padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  trainingDayLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  trainingDayEmoji: { fontSize: 28 },
  trainingDayTitle: { fontSize: 14, fontWeight: '700', color: '#111827' },
  trainingDayAnswer: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  trainingDayHint: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  trainingDayBtns: { flexDirection: 'row', gap: 8 },
  trainingBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 99, borderWidth: 1.5, borderColor: '#e5e7eb' },
  trainingBtnActiveYes: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
  trainingBtnActiveNo: { backgroundColor: '#8b5cf6', borderColor: '#8b5cf6' },
  trainingBtnText: { fontSize: 13, fontWeight: '700', color: '#6b7280' },
  trainingBtnTextActive: { color: 'white' },

  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12, marginHorizontal: 20 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 20, marginBottom: 24 },
  quickCard: {
    width: '47%', borderRadius: 20, padding: 18, position: 'relative',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 3,
  },
  quickCardBlue: { backgroundColor: '#3b82f6' },
  quickCardGreen: { backgroundColor: '#10b981' },
  quickCardPurple: { backgroundColor: '#8b5cf6' },
  quickCardOrange: { backgroundColor: '#f59e0b' },
  quickCardEmoji: { fontSize: 32, marginBottom: 12 },
  quickCardTitle: { fontSize: 15, fontWeight: '700', color: 'white', marginBottom: 4 },
  quickCardSub: { fontSize: 12, color: 'rgba(255,255,255,0.75)' },
  unreadBadge: { position: 'absolute', top: 12, right: 12, backgroundColor: '#ef4444', borderRadius: 99, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  unreadBadgeText: { color: 'white', fontSize: 11, fontWeight: '700' },

  chartCard: {
    backgroundColor: 'white', borderRadius: 20, marginHorizontal: 20,
    padding: 18, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  chartTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 12 },
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
