import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { setAvailability } from '../hooks/useFixtures'
import { syncPush } from '../lib/push'
import { logError } from '../lib/logger'
import { friendlyError } from '../lib/errors'
import { safeAppPath } from '../lib/navigation'
import Toast from './Toast'
import ForegroundAlert from './ForegroundAlert'
import { consumeAction } from '../lib/pushAction'

// Applies an availability choice made from a push notification's inline action
// (HANDOVER §4 / UX-AND-IA §4). Two paths from the service worker:
//   - app already open → postMessage { type:'mvf-avail', fixtureId, status }
//   - app opened cold  → URL ?mvf_action=<nonce>, a random token the service
//     worker stored in Cache Storage. A plain ?mvf_fixture=…&mvf_avail=… link
//     is ignored: it would let anyone with a link write someone's availability.
export default function PushActions() {
  const { user, profile, holding, loading, canRespond } = useAuth()
  const userId = user?.id
  const memberId = profile && !loading && !holding ? userId : null
  const waitingForProfile = !!(userId && loading && !holding)
  const pending = useRef([])
  const currentMember = useRef(null)
  const [notice, setNotice] = useState(null)
  const [incoming, setIncoming] = useState(null)

  useLayoutEffect(() => {
    currentMember.current = memberId
    const service = navigator.serviceWorker
    if (!memberId) {
      if (!waitingForProfile) { pending.current = []; return }
      // Browsers may start delivering messages at DOMContentLoaded, before
      // the signed-in player's profile has returned. Wait for sign-off before
      // showing anything or writing, and keep each delivery tied to its user.
      const buffer = event => pending.current.push({ owner: userId, data: event.data })
      service?.addEventListener('message', buffer)
      return () => service?.removeEventListener('message', buffer)
    }

    // Tell any open Fixtures view to refetch AFTER the write commits — otherwise
    // the focus-triggered refetch can race ahead of the upsert and redisplay the
    // previous status (looked like "I'm in" set Maybe). Fire once the write lands.
    const announce = () => window.dispatchEvent(new CustomEvent('mvf-availability-applied'))

    async function apply(fixtureId, status) {
      if (!canRespond || currentMember.current !== memberId) return
      if (!navigator.onLine) {
        setNotice({ tone: 'error', text: "You're offline. Reconnect to answer the fixture." })
        return
      }
      try {
        const { error } = await setAvailability(fixtureId, memberId, status)
        if (error) throw error
        if (currentMember.current !== memberId) return
        setNotice({ tone: 'success', text: `Availability saved · ${status === 'out' ? "can't make it" : status}.` })
        announce()
      } catch (e) {
        logError('write', e ?? 'push action failed', { op: 'pushAction', fixtureId, status })
        if (currentMember.current !== memberId) return
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

    const deliver = (d) => {
      if (d && d.type === 'mvf-avail' && typeof d.fixtureId === 'string' && d.fixtureId.trim() && ['in', 'maybe', 'out'].includes(d.status)) {
        apply(d.fixtureId, d.status)
      } else if (d && d.type === 'mvf-navigate' && typeof d.url === 'string') {
        // A tapped news / line-up notification with the app open. This
        // component sits outside the router, so re-broadcast for App to route.
        setIncoming(null)
        window.dispatchEvent(new CustomEvent('mvf-navigate', { detail: { url: d.url } }))
      } else if (d?.type === 'mvf-foreground' && typeof d.title === 'string' && document.visibilityState === 'visible') {
        setIncoming({
          owner: memberId, title: d.title, body: typeof d.body === 'string' ? d.body : '',
          teamKey: d.teamKey, kind: d.kind, url: safeAppPath(d.url) ?? '/fixtures',
        })
      }
    }
    const onMsg = event => deliver(event.data)
    service?.addEventListener('message', onMsg)
    for (const queued of pending.current.splice(0)) {
      if (queued.owner === memberId) deliver(queued.data)
    }
    // addEventListener alone does NOT start message delivery (only the
    // .onmessage setter does that implicitly) — without startMessages() the
    // SW's postMessage sits queued forever and app-open one-taps never land.
    service?.startMessages?.()
    return () => {
      currentMember.current = null
      service?.removeEventListener('message', onMsg)
    }
  }, [memberId, canRespond, userId, waitingForProfile])

  // Push token repair can wait until after paint.
  useEffect(() => {
    if (memberId) syncPush(memberId).catch((e) => logError('push', e ?? 'push sync failed', { op: 'syncPush' }))
  }, [memberId])

  return <>
    <Toast message={notice?.text} tone={notice?.tone} onDismiss={() => setNotice(null)} />
    <ForegroundAlert alert={memberId && incoming?.owner === memberId ? incoming : null}
      onDismiss={() => setIncoming(current => current === incoming ? null : current)} onOpen={url => {
        setIncoming(null)
        window.dispatchEvent(new CustomEvent('mvf-navigate', { detail: { url } }))
      }} />
  </>
}
