# Supabase Edge Functions — Push Notifikacije

## 1. `send-client-push`

Šalje push notifikaciju klijentu pri 3 događaja:
- **Poruka od trenera** (`messages` INSERT)
- **Trenerov komentar na check-in** (`checkins` UPDATE)
- **Novi paket dodijeljen** (`client_packages` INSERT)

### Deploy

```bash
supabase functions deploy send-client-push --no-verify-jwt
```

### Env varijable (Dashboard → Project Settings → Edge Functions → Secrets)

| Varijabla             | Opis                                              |
|-----------------------|---------------------------------------------------|
| `WEBHOOK_SECRET`      | Nasumičan string, npr. `openssl rand -hex 32`     |
| `EXPO_ACCESS_TOKEN`   | Opcionalno — Expo dashboard → Access Tokens       |

> `SUPABASE_URL` i `SUPABASE_SERVICE_ROLE_KEY` se automatski injektiraju.

### Database Webhooks (Dashboard → Database → Webhooks → Create Webhook)

Kreiraj **3 webhookа**:

| Naziv                      | Table            | Events   |
|----------------------------|------------------|----------|
| `notify_new_message`       | `messages`       | INSERT   |
| `notify_checkin_comment`   | `checkins`       | UPDATE   |
| `notify_new_package`       | `client_packages`| INSERT   |

Za svaki:
- **URL**: `https://<project-ref>.supabase.co/functions/v1/send-client-push`
- **HTTP method**: POST
- **HTTP headers**: `x-webhook-secret: <WEBHOOK_SECRET>`

---

## 2. `checkin-reminder`

Šalje podsjetnike klijentima koji nisu predali tjedni check-in.

### Deploy

```bash
supabase functions deploy checkin-reminder --no-verify-jwt
```

### Env varijable

| Varijabla             | Opis                                              |
|-----------------------|---------------------------------------------------|
| `CRON_SECRET`         | Nasumičan string za autentikaciju cron poziva     |
| `EXPO_ACCESS_TOKEN`   | Opcionalno                                        |

### Cron Setup (Dashboard → Database → Cron Jobs)

```sql
SELECT cron.schedule(
  'checkin-reminder-weekly',
  '0 9 * * 1',  -- svaki ponedjeljak u 09:00 UTC (11:00 CET)
  $$
    SELECT net.http_post(
      url := 'https://<project-ref>.supabase.co/functions/v1/checkin-reminder',
      headers := jsonb_build_object(
        'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
        'x-cron-secret', '<CRON_SECRET>',
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    )
  $$
);
```

> Zamijeni `<project-ref>`, `<SERVICE_ROLE_KEY>` i `<CRON_SECRET>` pravim vrijednostima.

---

## Tablica `expo_push_tokens`

Ako još ne postoji, kreiraj u SQL editoru:

```sql
CREATE TABLE IF NOT EXISTS expo_push_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid REFERENCES clients(id) ON DELETE CASCADE,
  token        text NOT NULL,
  platform     text NOT NULL,
  updated_at   timestamptz DEFAULT now(),
  UNIQUE(client_id)
);

ALTER TABLE expo_push_tokens ENABLE ROW LEVEL SECURITY;
-- Servis role key (Edge Functions) može sve — nije potrebna RLS policy za server-side upite
```
