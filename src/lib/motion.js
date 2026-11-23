// Motion vocabulary — one source of truth (DESIGN-SYSTEM §5). Restrained, premium,
// fast: the Linear / Sky-Sports register. Motion guides, it never taxes a core tap.
// Layout and press use the same spring. Larger surfaces carry a little more mass.
export const SPRING_SNAPPY = { type: 'spring', stiffness: 460, damping: 36, mass: 0.72 }
export const SPRING_SHEET = { type: 'spring', stiffness: 360, damping: 36, mass: 0.95 }
export const SPRING_DRIFT = { type: 'spring', stiffness: 90, damping: 20, mass: 0.9 }

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

// Press feedback for primary controls — a small, springy squeeze.
export const tap = { scale: 0.97 }

// ---------------------------------------------------------------------------
// Scroll + pointer craft. Everything below is pointer/scroll-linked rather than
// mount-linked: the app keeps responding after the first frame instead of
// animating once and going dead.
// ---------------------------------------------------------------------------

// Page furniture arriving in sequence rather than as one block — kicker, then
// heading, then the controls. `at(i)` is the delay for the i-th element.
export const SEQUENCE_STEP = 0.055
export const at = (i) => ({
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.34, ease: EASE, delay: i * SEQUENCE_STEP },
})

// Section reveal on scroll-in. `once` so a list doesn't re-animate every time
// it passes the fold, and a generous margin so it has finished by the time the
// section is properly in view (a reveal you can *see* running reads as jank).
export const revealOnScroll = {
  initial: { opacity: 0, y: 22 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '0px 0px -12% 0px' },
  transition: { duration: 0.44, ease: EASE },
}

// The sliding tab/nav indicator shares one layoutId per bar, so Framer tweens
// the old position to the new one — the underline draws across rather than
// blinking out and in somewhere else.
export const indicatorTransition = SPRING_SNAPPY
