import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const css = readFileSync('src/styles/tokens.css', 'utf8')

test('the viewport allows pinch zoom and accounts for each safe edge', () => {
  const html = readFileSync('index.html', 'utf8')
  expect(html.match(/<meta name="viewport"[^>]+>/)?.[0]).not.toMatch(/maximum-scale|user-scalable=no/)
  for (const edge of ['top', 'right', 'bottom', 'left']) {
    expect(css).toContain('env(safe-area-inset-' + edge)
  }
})

// Resolve semantic aliases as the browser does for these solid colour pairs.
function palette(block) {
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*(#[\da-f]{6}|var\(--[\w-]+\))\s*;/gi)].map(([, k, v]) => [k, v]))
}
function luminance(value, tokens) {
  if (value?.startsWith('var(')) return luminance(tokens[value.slice(4, -1)], tokens)
  const rgb = value.slice(1).match(/../g).map((c) => parseInt(c, 16) / 255)
    .map((c) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
}
test.each(['dark', 'light'])('body, secondary, team and status text reach AA on main surfaces (%s)', (theme) => {
  const base = css.match(/:root\s*\{([^}]+)\}/)[1]
  const dark = css.match(/\n\[data-ground="dark"\]\s*\{([^}]+)\}/)[1]
  const colours = { ...palette(base), ...palette(theme === 'dark' ? dark : '') }
  for (const ink of ['--bone', '--bone-mute', '--bone-dim', '--red-bright', '--green-bright', '--amber', '--gold']) {
    for (const paper of ['--ink', '--coal', '--slate']) {
      const pair = [ink, paper].map(k => luminance(colours[k], colours)).sort((a, b) => b - a)
      expect((pair[0] + .05) / (pair[1] + .05), ink + ' on ' + paper).toBeGreaterThanOrEqual(4.5)
    }
  }
  for (const [ink, paper, minimum] of [
    ['--on-action', '--action-fill', 4.5],
    ['--border-strong', '--surface-raised', 3],
    ['--focus', '--surface', 3],
  ]) {
    const [a, b] = [ink, paper].map(k => luminance(colours[k], colours)).sort((a, b) => b - a)
    expect((a + .05) / (b + .05), ink + ' on ' + paper).toBeGreaterThanOrEqual(minimum)
  }
})
