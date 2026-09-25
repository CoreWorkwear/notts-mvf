import { describe, test, expect } from 'vitest'
import { safeAppPath } from './navigation'

const ORIGIN = 'https://notts-mvf.pages.dev'

// Built from code points, not escape sequences: a literal backslash or tab in
// a test file is exactly the sort of character a shell, an editor or a patch
// tool quietly eats — and if it does, the test silently starts asserting that
// a harmless string is rejected. BS is the character the URL parser rewrites
// to '/'; TAB is one it strips.
const BS = String.fromCharCode(92)
const TAB = String.fromCharCode(9)
const LF = String.fromCharCode(10)
const NUL = String.fromCharCode(0)

describe('safeAppPath', () => {
  test('lets an ordinary in-app deep link through, query and hash intact', () => {
    expect(safeAppPath('/fixtures', ORIGIN)).toBe('/fixtures')
    expect(safeAppPath('/fixtures?mvf_fixture=abc&mvf_avail=in', ORIGIN))
      .toBe('/fixtures?mvf_fixture=abc&mvf_avail=in')
    expect(safeAppPath('/news#latest', ORIGIN)).toBe('/news#latest')
  })

  // The regression this function exists for: the old check was
  // `url.startsWith('/') && !url.startsWith('//')`, which every one of these
  // walks straight past on its way to another origin.
  test('refuses a backslash escape out of the app (CVE-2025-68470 shape)', () => {
    expect(safeAppPath('/' + BS + 'evil.com', ORIGIN)).toBeNull()
    expect(safeAppPath('/' + BS + BS + 'evil.com', ORIGIN)).toBeNull()
    expect(safeAppPath('/' + BS + '/evil.com/steal', ORIGIN)).toBeNull()
  })

  test('refuses control characters the URL parser would strip', () => {
    expect(safeAppPath('/' + TAB + 'javascript:alert(1)', ORIGIN)).toBeNull()
    expect(safeAppPath('/' + LF + 'https://evil.com', ORIGIN)).toBeNull()
    expect(safeAppPath('/' + NUL + 'evil', ORIGIN)).toBeNull()
  })

  test('refuses protocol-relative and absolute URLs', () => {
    expect(safeAppPath('//evil.com', ORIGIN)).toBeNull()
    expect(safeAppPath('https://evil.com/fixtures', ORIGIN)).toBeNull()
    expect(safeAppPath('http://notts-mvf.pages.dev/fixtures', ORIGIN)).toBeNull()
    expect(safeAppPath('javascript:alert(1)', ORIGIN)).toBeNull()
    expect(safeAppPath('data:text/html,<script>alert(1)</script>', ORIGIN)).toBeNull()
  })

  test('refuses a relative path, which would resolve against whatever screen you happen to be on', () => {
    expect(safeAppPath('fixtures', ORIGIN)).toBeNull()
    expect(safeAppPath('../admin', ORIGIN)).toBeNull()
  })

  test('fails closed on junk and on a missing origin', () => {
    expect(safeAppPath('', ORIGIN)).toBeNull()
    expect(safeAppPath(null, ORIGIN)).toBeNull()
    expect(safeAppPath(undefined, ORIGIN)).toBeNull()
    expect(safeAppPath({ url: '/fixtures' }, ORIGIN)).toBeNull()
    // No origin to compare against (a non-browser context) — refuse rather
    // than hand back a path nothing has vouched for.
    expect(safeAppPath('/fixtures', '')).toBeNull()
  })
})
