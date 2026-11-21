import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// registerType 'prompt' relies on the new service worker WAITING until the
// player taps Refresh. workbox skipWaiting/clientsClaim defeat that: the
// waiting event never fires (UpdatePrompt is dead) and the new worker takes
// over open tabs whose lazy chunks it has just deleted.
const src = readFileSync(process.cwd() + '/vite.config.js', 'utf8')
// Strip comments so the explanation above the setting can mention the words.
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '')

describe('service worker update strategy', () => {
  test("registerType is 'prompt'", () => {
    expect(code).toMatch(/registerType:\s*'prompt'/)
  })
  test('workbox does not skipWaiting or clientsClaim', () => {
    expect(code).not.toMatch(/skipWaiting\s*:\s*true/)
    expect(code).not.toMatch(/clientsClaim\s*:\s*true/)
  })
})
