import { useEffect } from 'react'

// Hardware back closes an open sheet instead of leaving the app (HANDOVER §5).
// Pushes a history entry when the sheet opens; a popstate (back press) calls
// onClose. Closing programmatically also unwinds the pushed entry.
export function useSheetBack(open, onClose) {
  useEffect(() => {
    if (!open) return

    window.history.pushState({ sheet: true }, '')
    const handlePop = () => onClose()
    window.addEventListener('popstate', handlePop)

    return () => {
      window.removeEventListener('popstate', handlePop)
      // If the sheet is being closed by the app (not by back), unwind our entry.
      if (window.history.state?.sheet) window.history.back()
    }
  }, [open, onClose])
}
