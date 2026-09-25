import { useEffect, useState } from 'react'

// Gyroscope tilt for the poster hero. The pointer tilt it mirrors only fires for
// a mouse, so on a phone — where the app actually lives — the hero had no depth
// response at all.
//
// Three things make this awkward, and all three are handled here rather than in
// the component:
//
//  1. iOS 13+ requires DeviceOrientationEvent.requestPermission(), called from a
//     user gesture. So this cannot just start; it reports `needs-permission` and
//     the toggle in Profile does the asking. Android fires the event with no
//     prompt. Once granted we remember it, or every cold start would be stuck
//     back at "needs permission" with no gesture in sight.
//  2. beta/gamma are absolute angles, not deltas. Holding a phone at a normal
//     reading angle is ~40° of beta, which would peg the tilt permanently. The
//     first reading becomes the rest position and everything is relative to it,
//     so however you happen to be holding it counts as level.
//  3. The axes swap when the phone rotates — landscape gamma is portrait beta.
//
// Returns { x, y } in -1..1 (null when inactive), the state, and the asker.
const PREF_KEY = 'mvf-tilt'
const GRANT_KEY = 'mvf-tilt-granted'

const read = (k) => { try { return window.localStorage.getItem(k) } catch { return null } }
const write = (k, v) => { try { window.localStorage.setItem(k, v) } catch { /* private mode */ } }

// Default on. It is a few degrees of parallax, not a feature to be consented to.
export const tiltEnabled = () => read(PREF_KEY) !== 'off'
export const setTiltEnabled = (on) => write(PREF_KEY, on ? 'on' : 'off')
export const tiltSupported = () =>
  typeof window !== 'undefined' && !!window.DeviceOrientationEvent

export function useDeviceTilt({ enabled = true, max = 22 } = {}) {
  const [tilt, setTilt] = useState(null)
  const [state, setState] = useState('idle') // idle | needs-permission | on | unavailable

  useEffect(() => {
    if (!enabled || !tiltEnabled()) { setTilt(null); setState('idle'); return }
    if (!tiltSupported()) { setState('unavailable'); return }
    if (typeof window.DeviceOrientationEvent.requestPermission === 'function') {
      // iOS. A grant we already recorded lets us attach without another prompt.
      setState(read(GRANT_KEY) === 'yes' ? 'on' : 'needs-permission')
      return
    }
    setState('on')
  }, [enabled])

  useEffect(() => {
    if (state !== 'on') return

    let rest = null
    const clamp = (v) => Math.max(-1, Math.min(1, v / max))

    function onOrient(e) {
      if (e.beta == null || e.gamma == null) return
      // screen.orientation is absent on older Safari, where window.orientation
      // still answers.
      const angle = window.screen?.orientation?.angle ?? window.orientation ?? 0
      const landscape = angle === 90 || angle === -90 || angle === 270
      const rawX = landscape ? e.beta : e.gamma
      const rawY = landscape ? -e.gamma : e.beta

      if (rest === null) { rest = { x: rawX, y: rawY }; return }
      setTilt({ x: clamp(rawX - rest.x), y: clamp(rawY - rest.y) })
    }
    // Rotating the handset makes the old rest position meaningless.
    const relevel = () => { rest = null }

    window.addEventListener('deviceorientation', onOrient)
    window.addEventListener('orientationchange', relevel)
    return () => {
      window.removeEventListener('deviceorientation', onOrient)
      window.removeEventListener('orientationchange', relevel)
      setTilt(null)
    }
  }, [state, max])

  // Must be called from a real user gesture (iOS refuses otherwise).
  async function requestTilt() {
    if (typeof window.DeviceOrientationEvent?.requestPermission !== 'function') return false
    try {
      const res = await window.DeviceOrientationEvent.requestPermission()
      if (res === 'granted') { write(GRANT_KEY, 'yes'); setState('on'); return true }
      setState('unavailable')
      return false
    } catch {
      setState('unavailable')
      return false
    }
  }

  return { tilt, state, requestTilt }
}
