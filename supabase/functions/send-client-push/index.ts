// send-client-push — Supabase Edge Function
//
// Triggered by database webhooks for 3 events:
//   1. messages    INSERT  (sender_id = trainer_id  →  notify client)
//   2. checkins    UPDATE  (trainer_comment added   →  notify client)
//   3. client_packages INSERT                       →  notify client
//
// Database Webhook setup (Supabase Dashboard → Database → Webhooks):
//   URL:    https://<project>.supabase.co/functions/v1/send-client-push
//   Method: POST
//   Secret header:  x-webhook-secret: <WEBHOOK_SECRET env var>
//   Events: messages(INSERT), checkins(UPDATE), client_packages(INSERT)
//
// Required env vars (Settings → Edge Functions → Secrets):
//   SUPABASE_URL              — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY — auto-injected
//   WEBHOOK_SECRET            — your own random string for verifying the webhook
//   EXPO_ACCESS_TOKEN         — optional, from expo.dev/accounts/.../access-tokens

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

type WebhookPayload = {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  schema: string
  record: Record<string, any>
  old_record: Record<string, any> | null
}

type PushMessage = {
  to: string
  title: string
  body: string
  data?: Record<string, string>
  sound?: 'default'
  badge?: number
}

async function sendExpoPush(messages: PushMessage[]): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Accept-Encoding': 'gzip, deflate',
  }
  const token = Deno.env.get('EXPO_ACCESS_TOKEN')
  if (token) headers['Authorization'] = `Bearer ${token}`

  await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(messages),
  })
}

Deno.serve(async (req) => {
  // Verify webhook secret
  const secret = Deno.env.get('WEBHOOK_SECRET')
  if (secret && req.headers.get('x-webhook-secret') !== secret) {
    return new Response('Unauthorized', { status: 401 })
  }

  let payload: WebhookPayload
  try {
    payload = await req.json()
  } catch {
    return new Response('Bad request', { status: 400 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { table, type, record, old_record } = payload

  // ── 1. New message from trainer ──────────────────────────────────────────
  if (table === 'messages' && type === 'INSERT') {
    // Only notify when trainer sends to client (not when client sends)
    if (record.sender_id !== record.trainer_id) {
      return new Response('Skipped: client message', { status: 200 })
    }

    const { data: tokenRow } = await supabase
      .from('expo_push_tokens')
      .select('token')
      .eq('client_id', record.client_id)
      .single()

    if (!tokenRow?.token) return new Response('No token', { status: 200 })

    // Fetch trainer name for a personalised notification
    const { data: trainer } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', record.trainer_id)
      .single()

    const trainerName = trainer?.full_name ?? 'Trener'
    const preview = (record.content as string)?.slice(0, 100) ?? ''

    await sendExpoPush([{
      to: tokenRow.token,
      title: trainerName,
      body: preview,
      data: { screen: 'chat' },
      sound: 'default',
    }])

    return new Response('OK', { status: 200 })
  }

  // ── 2. Trainer commented on a check-in ──────────────────────────────────
  if (table === 'checkins' && type === 'UPDATE') {
    const newComment = record.trainer_comment
    const oldComment = old_record?.trainer_comment ?? null

    // Only fire when a new comment is added (not on weight/value updates)
    if (!newComment || newComment === oldComment) {
      return new Response('Skipped: no new comment', { status: 200 })
    }

    const { data: tokenRow } = await supabase
      .from('expo_push_tokens')
      .select('token')
      .eq('client_id', record.client_id)
      .single()

    if (!tokenRow?.token) return new Response('No token', { status: 200 })

    const preview = (newComment as string).slice(0, 120)

    await sendExpoPush([{
      to: tokenRow.token,
      title: 'Komentar na check-in',
      body: preview,
      data: { screen: 'checkin' },
      sound: 'default',
    }])

    return new Response('OK', { status: 200 })
  }

  // ── 3. New package assigned ──────────────────────────────────────────────
  if (table === 'client_packages' && type === 'INSERT') {
    const { data: tokenRow } = await supabase
      .from('expo_push_tokens')
      .select('token')
      .eq('client_id', record.client_id)
      .single()

    if (!tokenRow?.token) return new Response('No token', { status: 200 })

    // Fetch package name if available
    let pkgName = 'Novi paket'
    if (record.package_id) {
      const { data: pkg } = await supabase
        .from('packages')
        .select('name')
        .eq('id', record.package_id)
        .single()
      if (pkg?.name) pkgName = pkg.name
    }

    await sendExpoPush([{
      to: tokenRow.token,
      title: 'Paket dodijeljen',
      body: `Tvoj trener ti je dodijelio paket: ${pkgName}`,
      data: { screen: 'package' },
      sound: 'default',
    }])

    return new Response('OK', { status: 200 })
  }

  // ── 4. Manual trainer ping ───────────────────────────────────────────────
  // Payload: { type: 'manual', client_id: '...', message: '...' }
  if ((payload as any).type === 'manual') {
    const { client_id, message } = payload as any

    const { data: tokenRow } = await supabase
      .from('expo_push_tokens')
      .select('token')
      .eq('client_id', client_id)
      .single()

    if (!tokenRow?.token) return new Response('No token', { status: 200 })

    await sendExpoPush([{
      to: tokenRow.token,
      title: 'Obavijest od trenera',
      body: message ?? 'Tvoj trener ti je poslao obavijest.',
      data: { screen: 'checkin' },
      sound: 'default',
    }])

    return new Response('OK', { status: 200 })
  }

  return new Response('Event not handled', { status: 200 })
})
