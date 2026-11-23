import { useSyncExternalStore } from 'react'

const preference = '(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)'
function read() {
  return !!window.matchMedia?.(preference).matches &&
    !navigator.connection?.saveData &&
    (navigator.deviceMemory ?? 8) > 4 &&
    (navigator.hardwareConcurrency || 8) > 4
}
function subscribe(update) {
  const media = window.matchMedia?.(preference)
  media?.addEventListener?.('change', update)
  navigator.connection?.addEventListener?.('change', update)
  return () => {
    media?.removeEventListener?.('change', update)
    navigator.connection?.removeEventListener?.('change', update)
  }
}
export const useDecorativeMotion = () => useSyncExternalStore(subscribe, read)
