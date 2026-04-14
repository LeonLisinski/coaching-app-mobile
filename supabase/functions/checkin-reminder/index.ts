// checkin-reminder — Supabase Edge Function (scheduled / cron)
//
// Sends a push notification to clients who haven't submitted their weekly check-in.
// Run via Supabase Cron (Dashboard → Database → Cron Jobs) or pg_cron:
//
//   SELECT cron.schedule(
//     'checkin-reminder',
//     '0 9 * * 1',   -- Every Monday at 09:00 UTC
//     $$
//       SELECT net.http_post(
//         url := 'https://<project>.supabase.co/functions/v1/checkin-reminder',
//         headers := '{"Authorization": "Bearer <service_role_key>", "x-cron-secret": "<CRON_SECRET>"}'::jsonb,
//         body := '{}'::jsonb
//       )
//     $$
//   );
//
// Or call it from the Supabase Dashboard Cron UI with the above headers.
//
// Required env vars:
//   SUPABASE_URL              — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY — auto-injected
//   CRON_SECRET               — your own random string to authenticate cron calls
//   EXPO_ACCESS_TOKEN         — optional

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

type PushMessage = {
  to: string
  title: string
  body: string
  data?: Record<string, string>
  sound?: 'default'
}

async function sendExpoPushBatch(messages: PushMessage[]): Promise<void> {
  if (messages.length === 0) return

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Accept-Encoding': 'gzip, deflate',
  }
  const token = Deno.env.get('EXPO_ACCESS_TOKEN')
  if (token) headers['Authorization'] = `Bearer ${token}`

  // Expo accepts up to 100 messages per batch
  for (let i = 0; i < messages.length; i += 100) {
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(messages.slice(i, i + 100)),
    })
  }
}

function getWeekStart(date: Date): string {
  const d = new Date(date)
  const day = d.getDay() // 0=Sun, 1=Mon, ...
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1)) // Monday
  return d.toISOString().split('T')[0]
}

Deno.serve(async (req) => {
  // Authenticate cron calls
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (cronSecret && req.headers.get('x-cron-secret') !== cronSecret) {
    // Also accept service_role JWT (for manual invocations from dashboard)
    const auth = req.headers.get('Authorization') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!auth.includes(serviceKey)) {
      return new Response('Unauthorized', { status: 401 })
    }
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const today = new Date()
  const weekStart = getWeekStart(today)

  // Get all clients with checkin config and push tokens
  const { data: configs, error } = await supabase
    .from('checkin_config')
    .select(`
      client_id,
      checkin_day,
      clients!inner(
        id,
        active,
        trainer_id,
        expo_push_tokens(token)
      )
    `)

  if (error || !configs) {
    return new Response(JSON.stringify({ error: error?.message }), { status: 500 })
  }

  // Get all client IDs that already submitted this week
  const clientIds = configs.map((c: any) => c.client_id)
  const { data: submitted } = await supabase
    .from('checkins')
    .select('client_id')
    .in('client_id', clientIds)
    .gte('date', weekStart)

  const submittedSet = new Set((submitted ?? []).map((r: any) => r.client_id))

  const messages: PushMessage[] = []

  for (const config of configs as any[]) {
    const client = config.clients
    if (!client?.active) continue

    // Skip if already submitted this week
    if (submittedSet.has(config.client_id)) continue

    const token = client.expo_push_tokens?.[0]?.token
    if (!token) continue

    // Day-of-week check: only remind on/after checkin_day
    // checkin_day: 0=Monday, 1=Tuesday, ... 6=Sunday (to match coach config)
    const todayDow = today.getDay() === 0 ? 6 : today.getDay() - 1
    const configuredDow = config.checkin_day ?? 0 // default Monday

    // Remind from the configured day through Sunday (+2 days grace)
    const daysDiff = (todayDow - configuredDow + 7) % 7
    if (daysDiff > 2) continue // too early or too late in the week

    messages.push({
      to: token,
      title: 'Check-in podsjetnik',
      body: 'Još nisi poslao/la tjedni check-in. Otvori app i pošalji ga!',
      data: { screen: 'checkin' },
      sound: 'default',
    })
  }

  await sendExpoPushBatch(messages)

  return new Response(
    JSON.stringify({ sent: messages.length, week_start: weekStart }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})
