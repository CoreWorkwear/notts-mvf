import { useState } from 'react'
import { haptic, hapticsAvailable, hapticsEnabled, setHapticsEnabled } from '../lib/haptics'
import { tiltSupported, tiltEnabled, setTiltEnabled, useDeviceTilt } from '../hooks/useDeviceTilt'

// Where the two device-feel settings live. They belong here rather than as a
// prompt on the hero: a poster that asks permission to wobble before it will
// show you the next game has its priorities backwards.
//
// The whole panel hides when the device can do neither, so an iPhone without
// vibration support and a desktop browser never see a section full of switches
// that do nothing.
export default function FeelSettings() {
  const [haptics, setHaptics] = useState(hapticsEnabled)
  const [tilt, setTilt] = useState(tiltEnabled)
  const { state: tiltState, requestTilt } = useDeviceTilt({ enabled: tilt })

  const showHaptics = hapticsAvailable()
  const showTilt = tiltSupported()
  if (!showHaptics && !showTilt) return null

  function toggleHaptics() {
    const next = !haptics
    setHaptics(next)
    setHapticsEnabled(next)
    // Demonstrate the thing being switched on, with the thing itself.
    if (next) haptic('confirm')
  }

  async function toggleTilt() {
    const next = !tilt
    setTilt(next)
    setTiltEnabled(next)
    // iOS only grants the sensor from inside a user gesture, so this is the one
    // moment we can ask. Doing it here means the hero never has to.
    if (next && tiltState === 'needs-permission') await requestTilt()
  }

  return (
    <div className="mt-5">
      <p className="kicker">ON THIS PHONE</p>
      <div className="col gap-2 mt-2">
        {showHaptics && (
          <Row
            label="Haptics"
            hint="A tap you can feel when your answer saves."
            on={haptics}
            onToggle={toggleHaptics}
          />
        )}
        {showTilt && (
          <Row
            label="Tilt the poster"
            hint={tiltState === 'unavailable'
              ? 'Your phone turned this down — allow motion access to use it.'
              : 'The next-game poster leans as you tilt your phone.'}
            on={tilt}
            onToggle={toggleTilt}
          />
        )}
      </div>

      <style>{`
        .feel-row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; }
        .feel-text { flex: 1; min-width: 0; }
        .feel-label { font-weight: 600; font-size: 15px; }
        .feel-hint { font-size: 12px; color: var(--bone-mute); margin-top: 2px; }
        /* A real switch, not a chip pretending to be one — this is a setting you
           leave in a state, not an action you take. */
        .feel-switch {
          flex: none; width: 46px; height: 28px; border-radius: 999px;
          background: var(--slate); border: 1px solid var(--line);
          padding: 2px; display: flex; align-items: center;
          transition: background var(--t-fast), border-color var(--t-fast);
        }
        .feel-switch[aria-checked="true"] { background: var(--green-dim-2); border-color: var(--green); }
        .feel-knob {
          width: 22px; height: 22px; border-radius: 50%;
          background: var(--bone-mute);
          transition: transform var(--t-med), background var(--t-fast);
        }
        .feel-switch[aria-checked="true"] .feel-knob { transform: translateX(18px); background: var(--green-bright); }
      `}</style>
    </div>
  )
}

function Row({ label, hint, on, onToggle }) {
  return (
    <div className="card feel-row">
      <div className="feel-text">
        <div className="feel-label">{label}</div>
        <div className="feel-hint">{hint}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        className="feel-switch"
        onClick={onToggle}
      >
        <span className="feel-knob" />
      </button>
    </div>
  )
}
