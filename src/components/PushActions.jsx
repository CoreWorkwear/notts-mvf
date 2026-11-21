import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { setAvailability } from '../hooks/useFixtures'
import { syncPush } from '../lib/push'
import { logError } from '../lib/logger'
import { friendlyError } from '../lib/errors'
import Toast from './Toast'
import { consumeAction } from '../lib/pushAction'

// Applies an availability choice made from a push notification's inline action
// (HANDOVER §4 / UX-AND-IA §4). Two paths from the service worker:
//   - app already open → postMessage { type:'mvf-avail', fixtureId, status }
//   - app opened cold  → URL ?mvf_action=<nonce>, a random token the service
//     worker stored in Cache Storage. A plain ?mvf_fixture=…&mvf_avail=… link
//     is ignored: it would let anyone with a link write someone's availability.
export default function PushActions() {
  const { user } = useAuth()
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    if (!user) return

    // Tell any open Fixtures view to refetch AFTER the write commits — otherwise
    // the focus-triggered refetch can race ahead of the upsert and redisplay the
    // previous status (looked like "I'm in" set Maybe). Fire once the write lands.
    const announce = () => window.dispatchEvent(new CustomEvent('mvf-availability-applied'))

    async function apply(fixtureId, status) {
      if (!navigator.onLine) {
        setNotice({ tone: 'error', text: "You're offline. Reconnect to answer the fixture." })
        return
      }
      try {
        const { error } = await setAvailability(fixtureId, user.id, status)
        if (error) throw error
        setNotice({ tone: 'success', text: `Availability saved · ${status === 'out' ? "can't make it" : status}.` })
        announce()
      } catch (e) {
        logError('write', e ?? 'push action failed', { op: 'pushAction', fixtureId, status })
        setNotice({ tone: 'error', text: friendlyError(e, "Couldn't save your answer. Open the fixture to try again.") })
      }
    }

    const params = new URLSearchParams(window.location.search)
    const nonce = params.get('mvf_action')
    if (nonce) {
      // Strip the param straight away: a reload must not replay it, and it is
      // single-use anyway (consumeAction deletes it).
      params.delete('mvf_action')
      const q = params.toString()
      window.history.replaceState(window.history.state, '', window.location.pathname + (q ? `?${q}` : '') + window.location.hash)
      consumeAction(nonce).then((act) => {
        if (act) apply(act.fixtureId, act.status)
      })
    }

    const onMsg = (e) => {
      const d = e.data
      if (d && d.type === 'mvf-avail' && d.fixtureId && ['in', 'maybe', 'out'].includes(d.status)) {
        apply(d.fixtureId, d.status)
      } else if (d && d.type === 'mvf-navigate' && typeof d.url === 'string') {
        // A tapped news / line-up notification with the app open. This
        // component sits outside the router, so re-broadcast for App to route.
        window.dispatchEvent(new CustomEvent('mvf-navigate', { detail: { url: d.url } }))
      }
    }
    navigator.serviceWorker?.addEventListener('message', onMsg)
    // addEventListener alone does NOT start message delivery (only the
    // .onmessage setter does that implicitly) — without startMessages() the
    // SW's postMessage sits queued forever and app-open one-taps never land.
    navigator.serviceWorker?.startMessages?.()

    // Heal the push lifecycle once per app open: a server-pruned token or a
    // rotated VAPID key otherwise means this player silently never gets a
    // reminder again. Best-effort — failures just mean we try next open.
    syncPush(user.id).catch((e) => logError('push', e ?? 'push sync failed', { op: 'syncPush' }))

    return () => navigator.serviceWorker?.removeEventListener('message', onMsg)
    // Keyed on the user ID on purpose: the session object is replaced on every
    // token refresh and would re-run the URL apply + push heal each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  return <Toast message={notice?.text} tone={notice?.tone} onDismiss={() => setNotice(null)} />
}
