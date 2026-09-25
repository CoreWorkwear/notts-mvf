import { motion, useScroll, useTransform, useReducedMotion } from 'framer-motion'

// The room the app sits in. Two very soft brand-coloured pools drifting on a
// minute-long cycle, plus a slow scroll-linked rise — enough that the charcoal
// reads as depth rather than a flat void, nowhere near enough to notice as an
// effect. Sits under everything (z-index 0, the grain is at 9999) and never
// takes a pointer event.
//
// Cheap by construction: no filters, no repaints. The pools are radial
// gradients on two boxes, drifting via compositor-only CSS transforms; the
// parallax is one transform on their shared parent. Off entirely under
// prefers-reduced-motion, which leaves the static gradients — the depth stays,
// the movement goes.
export default function AmbientField() {
  const reduce = useReducedMotion()
  const { scrollY } = useScroll()
  // Deliberately lazy: the field travels ~12% of the page's scroll, so content
  // slides over a near-stationary backdrop.
  const y = useTransform(scrollY, [0, 2000], [0, -240])

  return (
    <motion.div className="ambient" aria-hidden="true" style={reduce ? undefined : { y }}>
      <div className={'amb-pool amb-red' + (reduce ? '' : ' drifting')} />
      <div className={'amb-pool amb-green' + (reduce ? '' : ' drifting')} />
    </motion.div>
  )
}
