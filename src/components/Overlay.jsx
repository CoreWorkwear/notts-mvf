import { createContext, useContext } from 'react'
import { createPortal } from 'react-dom'

export const OverlayTarget = createContext(null)

// Fixed overlays escape the animated route. A toast inside a sheet stays
// inside its dialog, including its focus trap and reading order.
export default function Overlay({ children }) {
  const target = useContext(OverlayTarget)
  return target ? createPortal(
    <OverlayTarget.Provider value={null}>{children}</OverlayTarget.Provider>, target
  ) : children
}
