import { useSyncExternalStore } from 'react'

let deferred
const changed = 'mvf-install-available'

// Capture the browser event at startup. The user can visit You much later.
function update(event) {
  if (event.type === 'beforeinstallprompt') event.preventDefault()
  deferred = event.type === 'beforeinstallprompt' ? event : null
  window.dispatchEvent(new Event(changed))
}
window.addEventListener('beforeinstallprompt', update)
window.addEventListener('appinstalled', update)

function subscribe(fn) {
  window.addEventListener(changed, fn)
  return () => window.removeEventListener(changed, fn)
}

export default function InstallPrompt() {
  const prompt = useSyncExternalStore(subscribe, () => deferred)
  if (window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone) return null
  if (!prompt) {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    return ios ? <p className="muted mt-3">For match alerts, tap Share, then Add to Home Screen. Open Notts MvF there.</p> : null
  }
  async function install() {
    deferred = null
    window.dispatchEvent(new Event(changed))
    try { await prompt.prompt(); await prompt.userChoice } catch { /* Dismissed or already installed. */ }
  }
  return <button className="btn btn-ghost mt-3" onClick={install}>Add to home screen</button>
}
