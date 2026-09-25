import { motion } from 'framer-motion'
import { revealOnScroll, at } from '../lib/motion'

// A section that fades and rises as it comes into view, once. Lower down a long
// page — Results, Stats, the squad list — content that simply exists on arrival
// has no rhythm to it; this gives the scroll something to uncover.
export function Reveal({ children, className, delay = 0, ...rest }) {
  return (
    <motion.div
      className={className}
      {...revealOnScroll}
      transition={{ ...revealOnScroll.transition, delay }}
      {...rest}
    >
      {children}
    </motion.div>
  )
}

// The page's opening beat: kicker, then heading, then whatever sits beside it,
// each a breath apart instead of the whole block popping in together. `index`
// is the position in that sequence.
export function Sequence({ children, index = 0, className, ...rest }) {
  return (
    <motion.div className={className} {...at(index)} {...rest}>
      {children}
    </motion.div>
  )
}
