// The offer belongs to the document. Keep it available to a late React
// subscriber and keep each tab's decision independent of its neighbours.
let status = 'current'
let offeredWorker
const listeners = new Set()

export function subscribeToUpdate(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const getUpdateStatus = () => status

function setStatus(next) {
  if (status === next) return
  status = next
  for (const fn of listeners) fn()
}

function reloadIfAccepted() {
  if (status !== 'applying') return
  setStatus('reloading')
  window.location.reload()
}

export function acceptUpdate() {
  if (status !== 'ready') return
  setStatus('applying')
  if (offeredWorker.state === 'activated') reloadIfAccepted()
  else if (offeredWorker.state === 'installed') offeredWorker.postMessage({ type: 'SKIP_WAITING' })
}

export async function registerForUpdates() {
  const service = navigator.serviceWorker
  if (!service) return
  let registration
  try {
    registration = await service.register('/sw.js', { updateViaCache: 'none' })
  } catch { return } // A first launch may have no signal or storage permission.
  if (!registration) return

  function observe(worker) {
    if (!worker) return
    function changed() {
      if (worker.state === 'installed' && registration.active) {
        offeredWorker = worker
        setStatus('ready')
      } else if (worker.state === 'activated') {
        // Also handles an uncontrolled first visit and acceptance in another
        // window. Only the document whose player tapped Refresh may reload.
        if (offeredWorker === worker) reloadIfAccepted()
        worker.removeEventListener('statechange', changed)
      } else if (worker.state === 'redundant') {
        if (offeredWorker === worker) { offeredWorker = null; setStatus('current') }
        worker.removeEventListener('statechange', changed)
      }
    }
    worker.addEventListener('statechange', changed)
    changed()
  }
  registration.addEventListener('updatefound', () => observe(registration.installing))
  observe(registration.installing)
  observe(registration.waiting)
  // An old tab can miss all install events while the browser suspends it.
  // A new controller still signals an offer when that tab resumes.
  let controller = service.controller
  service.addEventListener('controllerchange', () => {
    const previous = controller
    controller = service.controller
    if (!previous || !controller) return
    if (status === 'applying') reloadIfAccepted()
    else if (status === 'current') {
      offeredWorker = controller
      setStatus('ready')
      observe(controller)
    }
  })
  const check = () => registration.update().catch(() => {})
  setInterval(check, 60 * 60 * 1000)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check()
  })
}
