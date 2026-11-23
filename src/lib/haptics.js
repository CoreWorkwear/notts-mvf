// Haptics — progressive enhancement only (DESIGN-SYSTEM §5).
//
// The Vibration API is Android/Chrome. iOS Safari does not implement it at all
// and never has, so roughly half the squad will never feel any of this. That is
// the whole reason it stays decorative: nothing here may ever be the only signal
// that something happened. Every call site still shows its own visible state.
//
// A named vocabulary rather than magic numbers at each call site, so "confirming
// something" feels the same everywhere in the app and we can retune it in one
// place. Durations are deliberately short — a Sunday-league app buzzing like a
// notification every time you touch it is worse than silence.

// Values are ms, or a [buzz, pause, buzz…] pattern.
export const PATTERNS = {
  // A control acknowledging a press. Barely there by design.
  tap: 8,
  // Your answer landed — the one the whole app is built around.
  confirm: 12,
  // Something completed that took a moment (a result logged, a squad saved).
  success: [10, 50, 18],
  // Refused, or failed. Two short knocks read as "no" without being alarming.
  warn: [14, 60, 14],
}

const STORE_KEY = 'mvf-haptics'
let sessionPreference

// Feature-detected once. Guarded because a locked-down browser can throw on
// touching navigator.vibrate rather than simply not having it.
function supported() {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
  } catch {
    return false
  }
}

// Opt-out, remembered per device. Storage can throw (private mode, blocked site
// data) and must never take the app down over a buzz, so failure reads as "on".
export function hapticsEnabled() {
  if (sessionPreference !== undefined) return sessionPreference
  try {
    return window.localStorage.getItem(STORE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setHapticsEnabled(on) {
  try {
    window.localStorage.setItem(STORE_KEY, on ? 'on' : 'off')
    sessionPreference = undefined
  } catch {
    sessionPreference = on
  }
}

// Whether the toggle is worth showing at all. No point offering a switch for
// something the device cannot do.
export function hapticsAvailable() {
  return supported() || (typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function')
}

// Fire a named pattern. Unknown names are ignored rather than guessed at, so a
// typo goes quiet instead of buzzing something random. Never throws: vibrate()
// rejects outside a user gesture on some builds, and that must not surface.
export function haptic(name, target) {
  if (!hapticsEnabled()) return false
  const pattern = PATTERNS[name]
  if (pattern == null) return false
  try {
    if (supported() && navigator.vibrate(pattern)) return true
  } catch { /* Some devices expose vibration but decline it. */ }

  // Pulse just the control that received the action. Individual scale composes
  // with the transform used for shared-element movement and causes no reflow.
  try {
    if (!target?.isConnected || typeof target.animate !== 'function' ||
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false
    target.animate([{ scale: '1' }, { scale: '.975' }, { scale: '1' }],
      { duration: 140, easing: 'ease-out' })
    return true
  } catch {
    return false
  }
}
