import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom has no matchMedia; Framer Motion's useReducedMotion reads it. Default to
// "no preference" so motion hooks work under test.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })
}

// jsdom has no IntersectionObserver either, and Framer's whileInView (the
// scroll reveals — components/Reveal.jsx) constructs one on mount. The stub
// reports the element as immediately in view, which is what a test wants: the
// revealed content is queryable without having to fake a scroll.
if (!window.IntersectionObserver) {
  window.IntersectionObserver = class {
    constructor(cb) { this.cb = cb }
    observe(el) { this.cb([{ target: el, isIntersecting: true, intersectionRatio: 1 }], this) }
    unobserve() {}
    disconnect() {}
    takeRecords() { return [] }
  }
  window.IntersectionObserverEntry = class {}
}

// jsdom has no layout, so window.scrollTo is a stub that logs "Not implemented"
// to stderr on every call. ScrollToTop (App.jsx) calls it on every route change,
// which buried the real test output in the noise. Replace it with a no-op that
// still records the scroll position, so a test can assert on it if it ever needs
// to.
window.scrollTo = (x, y) => {
  const opts = typeof x === 'object' && x !== null ? x : { left: x, top: y }
  window.scrollX = opts.left ?? window.scrollX ?? 0
  window.scrollY = opts.top ?? window.scrollY ?? 0
}

// Unmount React trees and reset history between tests so the sheet/history
// behaviour is tested from a clean slate each time.
afterEach(() => {
  cleanup()
  // Collapse any pushState entries left by a test.
  window.history.replaceState(null, '')
})
