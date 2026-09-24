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
  if (!supportedNow()) return null
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

// Unsubscribe FIRST, then drop the row. The other order left a live browser
// subscription with no row whenever unsubscribe() rejected (offline, SW
// mid-update — and sign-out races this against a timeout), which is exactly
// the "server pruned my token" shape syncPush heals by re-subscribing: the
// player switched push off and the next app open switched it back on. If the
// unsubscribe fails the row stays and this throws, so the toggle stays "on"
// and honest; a stale row after a successful unsubscribe is pruned by the
// sender's next 404/410.
export async function disablePush(profileId) {
  const sub = await currentSubscription()
  if (!sub) return
  const token = JSON.stringify(sub)
  await sub.unsubscribe()
  const { error } = await supabase.from('push_tokens').delete().eq('profile_id', profileId).eq('token', token)
  if (error) throw error
}

// Live capability check (unlike the import-time `pushSupported` const) so the
// sync path can be exercised under test and reacts to the real environment.
function supportedNow() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

// Is this browser subscription bound to OUR current VAPID key? A subscription
// created under a rotated-away key can never be delivered to again (the sender
// gets 403s, which are deliberately not pruned server-side — a config mistake
// there would nuke every token). Returns true when it can't tell, so an odd
// browser shape never causes churn.
export function subscriptionMatchesKey(sub, vapidB64) {
  try {
    const key = sub?.options?.applicationServerKey
    if (!key || !vapidB64) return true
    const a = new Uint8Array(key)
    const b = urlBase64ToUint8Array(vapidB64)
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
  } catch { return true }
}

// Startup heal for the push lifecycle (run once per app open, signed in).
// Two silent-death cases this recovers:
//   • the server pruned this device's token on a 404/410 (subscription expired
//     server-side) — the browser still hands back the dead subscription, so we
//     re-subscribe FRESH and store the new one;
//   • the VAPID key was rotated — same treatment.
// Opt-in stays explicit: with no browser subscription on THIS device we do
// nothing (disablePush removed it deliberately, and another device's rows are
// its own business — they are never touched from here).
export async function syncPush(profileId) {
  if (!profileId || !supportedNow()) return
  if (Notification.permission !== 'granted') return
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) return

  const { data: rows, error } = await supabase
    .from('push_tokens').select('id').eq('profile_id', profileId).eq('token', JSON.stringify(sub))
  if (error) throw error
  const healthy = (rows ?? []).length > 0 && subscriptionMatchesKey(sub, VAPID_PUBLIC)
  if (healthy) return

  // Dead or key-mismatched: replace the subscription and store the new one.
  if (!VAPID_PUBLIC) return
  await sub.unsubscribe()
  sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) })
  const { error: upErr } = await supabase
    .from('push_tokens')
    .upsert({ profile_id: profileId, token: JSON.stringify(sub), platform: platform() }, { onConflict: 'profile_id,token' })
  if (upErr) throw upErr
}
