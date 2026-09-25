import { useRef } from 'react'
import { motion, useSpring, useReducedMotion } from 'framer-motion'
import { SPRING_SNAPPY } from '../lib/motion'

// Cursor affinity: the child leans a few pixels toward the pointer while it's
// over it, and springs back on leave. Makes a primary CTA feel like it's aware
// of you instead of waiting to be hit.
//
// Desktop pointers only — checked via matchMedia rather than a touch sniff, so a
// laptop with a touchscreen still gets it and a phone never does (on touch the
// pointer *is* the tap, and a button that slides out from under a thumb is a
// misfire). Inert under reduced motion, and inert in jsdom, where matchMedia
// reports no match.
//
// `strength` is how far it travels per pixel of pointer offset; `max` caps it.
// Defaults are deliberately small: this should be felt, not watched.
export default function Magnetic({ children, strength = 0.22, max = 7, className, ...rest }) {
  const reduce = useReducedMotion()
  const ref = useRef(null)
  const x = useSpring(0, SPRING_SNAPPY)
  const y = useSpring(0, SPRING_SNAPPY)

  const fine = typeof window !== 'undefined'
    && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches

  if (reduce || !fine) return <div className={className} {...rest}>{children}</div>

  const clamp = (v) => Math.max(-max, Math.min(max, v * strength))

  function onMove(e) {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    x.set(clamp(e.clientX - (r.left + r.width / 2)))
    y.set(clamp(e.clientY - (r.top + r.height / 2)))
  }
  function onLeave() { x.set(0); y.set(0) }

  return (
    <motion.div
      ref={ref}
      className={className}
      style={{ x, y }}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      {...rest}
    >
      {children}
    </motion.div>
  )
}
