import { motion } from 'framer-motion'
import { useSheetBack } from '../hooks/useSheetBack'
import { sheetPanel } from '../lib/motion'

// Bottom sheet: springs up on mobile, centres on desktop. Grab handle, contained
// overscroll, hardware-back closes it (not the app). We keep the StrictMode/
// history-safe pattern — the sheet returns null when closed (instant unmount, no
// exit), so the regression-guarded close timing is unchanged — and only animate
// the ENTRANCE. Honours reduced motion via the app-level <MotionConfig>.
export default function Sheet({ open, onClose, children }) {
  useSheetBack(open, onClose)
  if (!open) return null
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <motion.div
        className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true"
        variants={sheetPanel} initial="initial" animate="animate"
      >
        <div className="grab-handle" />
        {children}
      </motion.div>
    </div>
  )
}
