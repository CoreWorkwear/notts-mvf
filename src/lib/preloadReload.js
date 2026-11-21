// A lazy chunk that 404s after a deploy (an old tab asking for a hashed file
// the new build no longer ships) fires 'vite:preloadError'. One reload fetches
// the new shell and fixes it; a second would mean the problem is not staleness,
// so a sessionStorage flag stops it looping. Storage can throw (private mode,
// blocked site data): then we do not reload at all, rather than risk a loop.
import { logError } from './logger'

export const PRELOAD_RELOAD_KEY = 'mvf:preloadReloaded'

// Returns true when it triggered a reload.
export function reloadOnceOnPreloadError(event, { storage, reload, log = logError } = {}) {
  let store
  try { store = storage ?? window.sessionStorage } catch { store = null }
  const doReload = reload ?? (() => window.location.reload())
  let already = true // unknown storage => assume we already tried
  try { already = store ? store.getItem(PRELOAD_RELOAD_KEY) === '1' : true } catch { already = true }
  try { log('fetch', event?.payload ?? 'preload error', { op: 'preloadError', reloaded: !already }) } catch { /* never throw */ }
  if (already) return false
  try { store.setItem(PRELOAD_RELOAD_KEY, '1') } catch { return false }
  event?.preventDefault?.()
  doReload()
  return true
}

// A page that loaded cleanly clears the flag so a LATER deploy can reload once too.
export function clearPreloadReloadFlag(storage) {
  try { (storage ?? window.sessionStorage).removeItem(PRELOAD_RELOAD_KEY) } catch { /* ignore */ }
}
