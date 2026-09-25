import { motion, useReducedMotion } from 'framer-motion'
import { SPRING_SNAPPY } from '../lib/motion'
import { haptic } from '../lib/haptics'

// Press physics. What Magnetic is for a mouse, this is for a thumb: the control
// gives under the finger and springs back, and fires a haptic as it goes down.
// `transform: scale(.97)` in CSS does the same job in principle, but it snaps to
// the value and snaps back — a spring settles, which is the difference between
// "a state changed" and "I pressed something".
//
// whileTap rather than hand-rolled pointer handlers or :active. :active on iOS
// needs a touch listener to fire at all and drops the moment the finger drifts;
// Framer's gesture already releases on pointercancel — which the browser fires
// the instant a scroll claims the gesture — so dragging a fixture list never
// leaves a row squashed under your thumb.
//
// Wraps; it does not intercept. The child keeps its own click handler.
export default function Pressable({
  children,
  scale = 0.96,
  feedback = 'tap',   // a haptics PATTERNS name, or null for silent
  className,
  disabled = false,
  ...rest
}) {
  const reduce = useReducedMotion()
  if (reduce || disabled) return <div className={className} {...rest}>{children}</div>

  return (
    <motion.div
      className={className}
      style={{ touchAction: 'manipulation' }}
      whileTap={{ scale }}
      transition={SPRING_SNAPPY}
      onTapStart={() => { if (feedback) haptic(feedback) }}
      {...rest}
    >
      {children}
    </motion.div>
  )
}
