import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { supabase } from './supabase'

// Notification handler — controls how notifications appear while app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

export async function registerForPushNotificationsAsync(clientId: string): Promise<string | null> {
  // Push notifications require a physical device
  if (!Device.isDevice) return null

  // Android: create a notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Obavijesti',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#3b82f6',
      sound: 'default',
    })
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync()
  let finalStatus = existingStatus

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }

  if (finalStatus !== 'granted') return null

  try {
    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ??
      (Constants as any)?.easConfig?.projectId

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId })
    const token = tokenData.data

    // Save token to Supabase — upsert so re-registrations update the existing row
    await supabase.from('expo_push_tokens').upsert(
      {
        client_id: clientId,
        token,
        platform: Platform.OS,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'client_id' }
    )

    return token
  } catch (error) {
    // Graceful failure — token registration fails without EAS project config
    console.warn('[Push] Token registration failed:', error)
    return null
  }
}

/*
 * Supabase table required:
 *
 * create table expo_push_tokens (
 *   id uuid primary key default gen_random_uuid(),
 *   client_id uuid references clients(id) on delete cascade,
 *   token text not null,
 *   platform text not null,
 *   updated_at timestamptz default now(),
 *   unique(client_id)
 * );
 *
 * To trigger push notifications when trainer sends a message,
 * deploy the Supabase Edge Function at:
 *   supabase/functions/send-client-push/index.ts
 */
