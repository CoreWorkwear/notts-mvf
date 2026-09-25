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
  try {
    return window.localStorage.getItem(STORE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setHapticsEnabled(on) {
  try {
    window.localStorage.setItem(STORE_KEY, on ? 'on' : 'off')
  } catch {
    // A device that cannot remember the preference still honours it this session
    // — the setting simply doesn't persist. Not worth surfacing.
  }
}

// Whether the toggle is worth showing at all. No point offering a switch for
// something the device cannot do.
export function hapticsAvailable() {
  return supported()
}

// Fire a named pattern. Unknown names are ignored rather than guessed at, so a
// typo goes quiet instead of buzzing something random. Never throws: vibrate()
// rejects outside a user gesture on some builds, and that must not surface.
export function haptic(name) {
  if (!supported() || !hapticsEnabled()) return false
  const pattern = PATTERNS[name]
  if (pattern == null) return false
  try {
    return navigator.vibrate(pattern) === true
  } catch {
    return false
  }
}
