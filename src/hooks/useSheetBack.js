import { useEffect, useRef } from 'react'

// Hardware back closes an open sheet instead of leaving the app (HANDOVER §5).
// When the sheet opens we push a history entry and listen for popstate (the
// back press) to close it.
//
// We deliberately do NOT call history.back() when the sheet closes
// programmatically. Doing so fires a popstate that a *sibling* sheet's listener
// catches during a close-one/open-another transition (e.g. fixture detail →
// "Log the result"), snapping the newly-opened sheet shut. The cost of not
// unwinding is one stale history entry per button-close, which is harmless;
// the hardware-back-closes-the-sheet behaviour still holds via the listener.
//
// onClose is read through a ref so the effect depends only on `open` — a parent
// re-render with a fresh inline onClose no longer tears the listener down (and
// previously re-triggered the same history.back()).
export function useSheetBack(open, onClose) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    window.history.pushState({ sheet: true }, '')
    const handlePop = () => onCloseRef.current()
    window.addEventListener('popstate', handlePop)
    return () => window.removeEventListener('popstate', handlePop)
  }, [open])
}
