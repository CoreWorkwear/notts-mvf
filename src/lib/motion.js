// Motion vocabulary — one source of truth (DESIGN-SYSTEM §5). Restrained, premium,
// fast: the Linear / Sky-Sports register. Motion guides, it never taxes a core tap.
// Everything here is gated by prefers-reduced-motion at the app root via
// <MotionConfig reducedMotion="user"> — Framer drops transforms/opacity to instant.

// The token ease (cubic-bezier(.2,.8,.2,1)) as a Framer array.
export const EASE = [0.2, 0.8, 0.2, 1]

// Page / route change: a quick crossfade with a whisper of upward drift. Kept
// short so tab-hopping feels instant, not like a transition tax.
export const pageTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.16, ease: EASE },
}

// List/squad entrance: children fade-rise a beat apart (§5 stagger). Put
// `listContainer` on the wrapper and `listItem` on each row.
export const listContainer = {
  animate: { transition: { staggerChildren: 0.035, delayChildren: 0.03 } },
}
export const listItem = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE } },
}

// Bottom sheet: spring up from the bottom. NOTE the sheet stays MOUNTED with an
// `open` flag (StrictMode-safe pattern) — we animate between these states, we do
// NOT mount/unmount, so this is used as animate={open ? 'open' : 'closed'}.
export const sheetPanel = {
  closed: { y: '100%', transition: { duration: 0.2, ease: EASE } },
  open: { y: 0, transition: { type: 'spring', stiffness: 380, damping: 34 } },
}
export const sheetBackdrop = {
  closed: { opacity: 0, transition: { duration: 0.18, ease: EASE } },
  open: { opacity: 1, transition: { duration: 0.2, ease: EASE } },
}

// Press feedback for primary controls — a small, springy squeeze.
export const tap = { scale: 0.97 }
