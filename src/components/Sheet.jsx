import { useSheetBack } from '../hooks/useSheetBack'

// Bottom sheet: slides up on mobile, centres on desktop. Grab handle, contained
// overscroll, hardware-back closes it (not the app).
export default function Sheet({ open, onClose, children }) {
  useSheetBack(open, onClose)
  if (!open) return null
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="grab-handle" />
        {children}
      </div>
    </div>
  )
}
