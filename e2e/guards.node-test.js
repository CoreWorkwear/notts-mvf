import test from 'node:test'
import assert from 'node:assert/strict'
import { isPlaceholderUrl, isTestAccount, assertDeletableTestUser } from './guards.js'

// Not named *.test.js on purpose: Playwright's testDir is ./e2e and would pick
// that up. Run with: node --test e2e/guards.node-test.js

test('marker or legacy E2E name is a test account', () => {
  assert.equal(isTestAccount({ user_metadata: { e2e: true } }), true)
  assert.equal(isTestAccount({ user_metadata: { first_name: 'E2E', last_name: 'Admin' } }), true)
  assert.equal(isTestAccount({ user_metadata: { first_name: 'E2E', last_name: 'Player' } }), true)
})

test('a real member is never a test account', () => {
  assert.equal(isTestAccount({ user_metadata: { first_name: 'Sam', last_name: 'Jones' } }), false)
  assert.equal(isTestAccount({ user_metadata: { first_name: 'E2E', last_name: 'Jones' } }), false)
  assert.equal(isTestAccount({ user_metadata: { e2e: 'true' } }), false)
  assert.equal(isTestAccount({ user_metadata: {} }), false)
  assert.equal(isTestAccount({}), false)
  assert.equal(isTestAccount(null), false)
})

test('assertDeletableTestUser throws naming the email for a real account', () => {
  assert.throws(() => assertDeletableTestUser({ user_metadata: { first_name: 'Sam' } }, 'sam@club.test'), /sam@club\.test.*NOT a test account/s)
  const u = { user_metadata: { e2e: true } }
  assert.equal(assertDeletableTestUser(u, 'x@y.z'), u)
})

test('CI placeholder URL is detected, real projects are not', () => {
  assert.equal(isPlaceholderUrl('https://ci-placeholder.supabase.co'), true)
  assert.equal(isPlaceholderUrl('https://vgeosccpwsdosbcnpcve.supabase.co'), false)
  assert.equal(isPlaceholderUrl(''), false)
  assert.equal(isPlaceholderUrl('not a url'), false)
})
