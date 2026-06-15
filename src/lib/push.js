import { supabase } from './supabase'

// Web Push (HANDOVER §10 infra). Android solid; iOS best-effort (and only when
// installed to the home screen on iOS 16.4+). Subscriptions live in push_tokens.

export const pushSupported =
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY

// VAPID public key (base64url) → Uint8Array for applicationServerKey.
export function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function platform() {
  const ua = navigator.userAgent || ''
  if (/android/i.test(ua)) return 'android'
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  return 'web'
}

export async function currentSubscription() {
  if (!pushSupported) return null
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

// Ask permission, subscribe, and store the subscription on push_tokens.
export async function enablePush(profileId) {
  if (!pushSupported) throw new Error("This device doesn't support push.")
  if (!VAPID_PUBLIC) throw new Error('Push isn’t configured (missing VAPID key).')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Notifications were blocked.')

  const reg = await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) }))

  const token = JSON.stringify(sub)
  const { error } = await supabase
    .from('push_tokens')
    .upsert({ profile_id: profileId, token, platform: platform() }, { onConflict: 'profile_id,token' })
  if (error) throw error
  return sub
}

export async function disablePush(profileId) {
  const sub = await currentSubscription()
  if (sub) {
    await supabase.from('push_tokens').delete().eq('profile_id', profileId).eq('token', JSON.stringify(sub))
    await sub.unsubscribe()
  }
}
