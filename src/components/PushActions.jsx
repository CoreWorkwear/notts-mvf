import { useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { setAvailability } from '../hooks/useFixtures'

// Applies an availability choice made from a push notification's inline action
// (HANDOVER §4 / UX-AND-IA §4). Two paths from the service worker:
//   - app already open → postMessage { type:'mvf-avail', fixtureId, status }
//   - app opened cold  → URL ?mvf_fixture=…&mvf_avail=in|maybe|out
export default function PushActions() {
  const { user } = useAuth()

  useEffect(() => {
    if (!user) return

    // Tell any open Fixtures view to refetch AFTER the write commits — otherwise
    // the focus-triggered refetch can race ahead of the upsert and redisplay the
    // previous status (looked like "I'm in" set Maybe). Fire once the write lands.
    const announce = () => window.dispatchEvent(new CustomEvent('mvf-availability-applied'))

    const params = new URLSearchParams(window.location.search)
    const fx = params.get('mvf_fixture')
    const av = params.get('mvf_avail')
    if (fx && ['in', 'maybe', 'out'].includes(av)) {
      setAvailability(fx, user.id, av).finally(() => {
        announce()
        params.delete('mvf_fixture'); params.delete('mvf_avail')
        const q = params.toString()
        window.history.replaceState(null, '', window.location.pathname + (q ? `?${q}` : ''))
      })
    }

    const onMsg = (e) => {
      const d = e.data
      if (d && d.type === 'mvf-avail' && d.fixtureId && ['in', 'maybe', 'out'].includes(d.status)) {
        setAvailability(d.fixtureId, user.id, d.status).finally(announce)
      }
    }
    navigator.serviceWorker?.addEventListener('message', onMsg)
    return () => navigator.serviceWorker?.removeEventListener('message', onMsg)
  }, [user?.id])

  return null
}
