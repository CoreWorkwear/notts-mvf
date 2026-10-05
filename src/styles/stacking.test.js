import { describe, test, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'

// Every bottom sheet, toast and full-screen overlay is rendered somewhere inside
// <main> and escapes upward on position: fixed with a z-index above the header
// and bottom nav (50): sheet 100, toast 200. That only works while nothing
// between it and the root is a stacking context (which caps the overlay's
// z-index at the ancestor's) or a containing block for fixed boxes (which pins
// it to the ancestor instead of the viewport).
//
// motion.css once gave `main` a z-index of 1. Every sheet's save button went
// under the bottom nav and every error toast under the header, on Android and
// iPhone alike, with the whole suite green: vitest runs css:false, so nothing
// in the DOM was wrong. This reads the stylesheets themselves. The real-browser
// version of the same check is e2e/overlays.spec.js.
//
// Vitest runs from the project root (vite.config.js lives there).
const dir = process.cwd() + '/src/styles/'
const stylesheets = readdirSync(dir)
  .filter((f) => f.endsWith('.css'))
  .map((f) => [f, readFileSync(dir + f, 'utf8')])

// The chain every overlay sits in. The theme attribute lives on <html>.
const SHELL = new Set(['html', ':root', '[data-theme="light"]', 'body', '#root', 'main'])

// Property → the only values that leave a box a plain, non-trapping ancestor.
const HARMLESS = {
  'z-index': ['auto'],
  position: ['static', 'relative'], // fixed/sticky always make a stacking context
  transform: ['none'], translate: ['none'], rotate: ['none'], scale: ['none'],
  perspective: ['none'],
  filter: ['none'], 'backdrop-filter': ['none'], '-webkit-backdrop-filter': ['none'],
  opacity: ['1'],
  'will-change': ['auto'],
  contain: ['none'],
  'container-type': ['normal'], container: ['none'],
  isolation: ['auto'],
  'mix-blend-mode': ['normal'],
  'clip-path': ['none'], mask: ['none'], 'mask-image': ['none'],
  'content-visibility': ['visible'],
}

// Innermost `selectors { declarations }` blocks, however deeply they sit in
// @media / @supports. An at-rule's own prelude never matches: its body holds
// braces.
function rules(text) {
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({
    selectors: sel.split(';').pop().split(',').map((s) => s.trim().replace(/\s+/g, ' ')),
    decls: body.split(';')
      .map((d) => d.split(':'))
      .filter(([prop, ...value]) => prop.trim() && value.length)
      .map(([prop, ...value]) => [
        prop.trim().toLowerCase(),
        value.join(':').replace(/!important/i, '').trim().toLowerCase(),
      ]),
  }))
}

function shellOffences(files) {
  const out = []
  for (const [file, text] of files) {
    for (const { selectors, decls } of rules(text)) {
      const shell = selectors.filter((s) => SHELL.has(s))
      if (!shell.length) continue
      for (const [prop, value] of decls) {
        if (HARMLESS[prop] && !HARMLESS[prop].includes(value)) out.push(`${file}: ${shell.join(', ')} { ${prop}: ${value} }`)
      }
    }
  }
  return out
}

describe('the page shell never traps an overlay', () => {
  test('no rule on html, body, #root or main makes a stacking context or a fixed containing block', () => {
    expect(shellOffences(stylesheets)).toEqual([])
  })

  // A guard that silently matches nothing passes forever, so prove it sees the
  // rules it is guarding...
  test('it actually reads the shell rules', () => {
    const mainDecls = stylesheets.flatMap(([, text]) => rules(text))
      .filter((r) => r.selectors.includes('main'))
      .flatMap((r) => r.decls)
    expect(mainDecls).toContainEqual(['position', 'relative'])
  })

  // ...and that it catches the two rules that actually shipped on main.
  test('it catches the rules that shipped: main { z-index: 1 } and main { container-type }', () => {
    const shipped = [['motion.css', `
      /* Content sits above the field. */
      main { position: relative; z-index: 1; }
      @supports (container-type: inline-size) {
        main { container-type: inline-size; container-name: app; }
        @container app (max-width: 340px) { .manage-grid { grid-template-columns: 1fr; } }
      }
    `]]
    expect(shellOffences(shipped)).toEqual([
      'motion.css: main { z-index: 1 }',
      'motion.css: main { container-type: inline-size }',
    ])
  })

  test('descendants are out of scope: only the shell elements themselves are checked', () => {
    expect(shellOffences([['x.css', 'main .hero { transform: rotate(2deg); z-index: 3 } .toast { z-index: 200 }']])).toEqual([])
  })
})
