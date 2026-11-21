import { useEffect, useRef } from 'react'

const openSheets = []

// Hardware back closes an open sheet instead of leaving the app (HANDOVER §5).
// When the sheet opens we push a history entry and listen for popstate (the
// back press) to close it.
//
// We deliberately do NOT call history.back() when the sheet closes
// programmatically. Doing so fires a popstate that a *sibling* sheet's listener
// catches during a close-one/open-another transition (e.g. fixture detail →
// "Log the result"), snapping the newly-opened sheet shut. The cost of not
// unwinding is one reusable entry for that route. Preserve router state and
// let only the foremost open sheet consume a hardware Back.
//
// onClose is read through a ref so the effect depends only on `open` — a parent
// re-render with a fresh inline onClose no longer tears the listener down (and
// previously re-triggered the same history.back()).
export function useSheetBack(open, onClose) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    if (openSheets.length || !window.history.state?.sheet) {
      window.history.pushState({ ...window.history.state, sheet: true }, '')
    }
    openSheets.push(onCloseRef)
    const handlePop = () => {
      if (openSheets.at(-1) === onCloseRef) onCloseRef.current()
    }
    window.addEventListener('popstate', handlePop)
    return () => {
      openSheets.splice(openSheets.indexOf(onCloseRef), 1)
      window.removeEventListener('popstate', handlePop)
    }
  }, [open])
}
