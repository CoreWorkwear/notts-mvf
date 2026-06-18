import { motion } from 'framer-motion'
import { listContainer, listItem } from '../lib/motion'

// A list whose children fade-rise a beat apart on mount (DESIGN-SYSTEM §5). Unlike
// the old CSS `.stagger` (capped at 6 children) this scales to any length and
// honours reduced motion via the app-level <MotionConfig>. Drop-in for a list
// wrapper: <Stagger className="col gap-2"> … <StaggerItem key=…>row</StaggerItem> </Stagger>.
export function Stagger({ children, className, ...rest }) {
  return (
    <motion.div className={className} variants={listContainer} initial="initial" animate="animate" {...rest}>
      {children}
    </motion.div>
  )
}

export function StaggerItem({ children, className, ...rest }) {
  return (
    <motion.div className={className} variants={listItem} {...rest}>
      {children}
    </motion.div>
  )
}
