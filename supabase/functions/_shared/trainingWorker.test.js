import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { describe, test, expect, vi, beforeAll } from 'vitest'
import { timingSafeEqualStrings } from './auth.js'
import { deliverTrainingPush, sendTrainingPush } from './trainingPush.js'

// Execute the actual Deno entry with injected imports, after stripping types.
// Nothing here has a real network transport, service key, VAPID key or secret.
let source
beforeAll(async () => {
  const entry = resolve('supabase/functions/run-training-push/index.ts')
  const original = await readFile(entry, 'utf8')
  // esbuild requires Node's native typed arrays; jsdom replaces their realm.
  source = execFileSync(process.execPath, ['--input-type=module', '-e',
    "import { transformSync } from 'esbuild'; import { readFileSync } from 'node:fs'; process.stdout.write(transformSync(readFileSync(0, 'utf8'), { loader: 'ts' }).code)",
  ], { input: original.replace(/^import .*$/gm, ''), encoding: 'utf8' })
})

function worker(values = {}) {
  const env = { CRON_SECRET: 'synthetic-cron', ...values }
  const rpc = vi.fn(async name => ({ data: name === 'training_push_claim' ? [] : true, error: null }))
  const createClient = vi.fn(() => ({ rpc }))
  const setVapidDetails = vi.fn()
  const fetch_ = vi.fn(async () => { throw new Error('No network permitted') })
  const log = { id: 'synthetic-request', elapsed: () => 0, info: vi.fn(), error: vi.fn() }
  let handler
  vm.runInNewContext(source, {
    Deno: { env: { get: key => env[key] }, serve: fn => { handler = fn } },
    Response, AbortSignal, fetch: fetch_, createClient,
    webpush: { setVapidDetails, generateRequestDetails: vi.fn() },
    timingSafeEqualStrings, deliverTrainingPush, sendTrainingPush,
    mkLog: () => log, internalErrorBody: requestId => ({ error: 'internal error', requestId }),
  })
  const request = (secret, method = 'POST') => ({ method, headers: new Headers(secret === undefined ? {} : { 'x-cron-secret': secret }) })
  return { handler, request, rpc, createClient, setVapidDetails, fetch_, log }
}

describe('private worker service gate and wiring', () => {
  test('missing, incorrect and unset cron secrets cannot claim or send', async () => {
    const w = worker()
    for (const secret of [undefined, 'wrong']) {
      const response = await w.handler(w.request(secret))
      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({ error: 'unauthorized', requestId: 'synthetic-request' })
    }
    expect((await worker({ CRON_SECRET: '' }).handler(w.request('synthetic-cron'))).status).toBe(401)
    expect(w.createClient).not.toHaveBeenCalled()
    expect(w.fetch_).not.toHaveBeenCalled()
  })

  test('authenticated non-POST is refused before creating a service client', async () => {
    const w = worker()
    expect((await w.handler(w.request('synthetic-cron', 'GET'))).status).toBe(405)
    expect(w.createClient).not.toHaveBeenCalled()
  })

  test('empty cron batch claims with service RPC only and has no external push', async () => {
    const w = worker({ SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service' })
    const response = await w.handler(w.request('synthetic-cron'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ requestId: 'synthetic-request', claimed: 0, sent: 0, failed: 0, finishFailed: 0 })
    expect(w.rpc.mock.calls).toEqual([['training_push_claim', { p_limit: 20 }]])
    expect(w.createClient).toHaveBeenCalledWith('https://synthetic.invalid', 'synthetic-service', expect.objectContaining({ auth: { persistSession: false, autoRefreshToken: false } }))
    expect(w.fetch_).not.toHaveBeenCalled()
  })

  test('RPC errors return generic 500 and never expose provider or database details', async () => {
    const w = worker()
    w.rpc.mockResolvedValue({ data: null, error: { message: 'sensitive token' } })
    const response = await w.handler(w.request('synthetic-cron'))
    expect(response.status).toBe(500)
    expect(JSON.stringify(await response.json())).not.toContain('sensitive')
    expect(JSON.stringify(w.log.error.mock.calls)).not.toContain('sensitive')
  })
})
