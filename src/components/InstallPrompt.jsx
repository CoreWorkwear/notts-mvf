import { useEffect, useState } from 'react'

// "Add to home screen" nudge. Uses the beforeinstallprompt event (Android /
// desktop Chromium); iOS Safari has no such event (install is Share → Add to
// Home Screen), so this simply doesn't show there. Dismissal is remembered.
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState(null)
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem('pwa-install-dismissed') === '1' } catch { return false }
  })

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setDeferred(e) }
    const onInstalled = () => setDeferred(null)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (!deferred || dismissed) return null

  const install = async () => {
    deferred.prompt()
    try { await deferred.userChoice } catch {}
    setDeferred(null)
  }
  const dismiss = () => {
    setDismissed(true)
    try { localStorage.setItem('pwa-install-dismissed', '1') } catch {}
  }

  return (
    <div className="install-banner" role="dialog" aria-label="Install app">
      <span className="ib-text">Add Notts MvF to your home screen</span>
      <button className="btn btn-primary ib-go" onClick={install}>Install</button>
      <button className="ib-x" onClick={dismiss} aria-label="Not now">✕</button>
      <style>{`
        .install-banner {
          position: fixed; left: 50%; transform: translateX(-50%);
          bottom: calc(96px + var(--safe-b)); z-index: 90; width: min(92vw, 520px);
          display: flex; align-items: center; gap: 10px;
          background: var(--glass); backdrop-filter: blur(14px);
          border: 1px solid var(--line); border-radius: 14px; padding: 10px 12px;
          box-shadow: 0 16px 38px -12px rgba(0,0,0,.6);
        }
        .ib-text { flex: 1; font-size: 14px; font-weight: 600; }
        .ib-go { padding: 8px 16px; }
        .ib-x { background: none; border: none; color: var(--bone-mute); font-size: 14px; padding: 6px; }
      `}</style>
    </div>
  )
}
