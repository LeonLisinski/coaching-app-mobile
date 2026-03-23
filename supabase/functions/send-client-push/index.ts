/**
 * Supabase Edge Function: send-client-push
 *
 * Triggered by a Supabase Database Webhook on INSERT to the `messages` table.
 * Sends an Expo Push Notification to the client when the trainer sends a message.
 *
 * Deploy:
 *   supabase functions deploy send-client-push
 *
 * Set as a Database Webhook in Supabase Dashboard:
 *   Table: messages
 *   Event: INSERT
 *   URL: https://<project>.supabase.co/functions/v1/send-client-push
 *   Headers: { Authorization: Bearer <SERVICE_ROLE_KEY> }
 *
 * Required Supabase table (run once):
 *   create table expo_push_tokens (
 *     id uuid primary key default gen_random_uuid(),
 *     client_id uuid references clients(id) on delete cascade,
 *     token text not null,
 *     platform text not null,
 *     updated_at timestamptz default now(),
 *     unique(client_id)
 *   );
 */

// Edge Function runs on Deno — declare globals so TS server doesn't error
/* eslint-disable */
declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void
  env: { get: (key: string) => string | undefined }
}

// @ts-ignore — Deno URL imports are valid at runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

interface MessageRecord {
  id: string
  client_id: string
  trainer_id: string
  sender_id: string
  content: string
  created_at: string
}

Deno.serve(async (req: Request) => {
  // Verify the request comes from our Supabase webhook (not public internet)
  const webhookSecret = Deno.env.get('WEBHOOK_SECRET')
  if (webhookSecret) {
    const incoming = req.headers.get('x-webhook-secret')
    if (incoming !== webhookSecret) {
      return new Response('Unauthorized', { status: 401 })
    }
  }

  try {
    const { record } = await req.json() as { record: MessageRecord }

    // Only send push when trainer is the sender (sender_id === trainer_id)
    if (!record || record.sender_id !== record.trainer_id) {
      return new Response('Not a trainer message', { status: 200 })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Get client's Expo push token
    const { data: tokenRow } = await supabase
      .from('expo_push_tokens')
      .select('token')
      .eq('client_id', record.client_id)
      .single()

    if (!tokenRow?.token) {
      return new Response('No push token for client', { status: 200 })
    }

    // Get trainer's name for the notification title
    const { data: trainerProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', record.trainer_id)
      .single()

    const trainerName = trainerProfile?.full_name ?? 'Tvoj trener'
    const body = record.content.length > 80
      ? record.content.slice(0, 77) + '...'
      : record.content

    // Send Expo Push Notification
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        to: tokenRow.token,
        title: `💬 ${trainerName}`,
        body,
        data: { screen: 'chat' },
        sound: 'default',
        badge: 1,
        priority: 'high',
      }),
    })

    const result = await response.json()
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('[send-client-push]', error)
    return new Response(JSON.stringify({ error: String(error) }), { status: 500 })
  }
})
