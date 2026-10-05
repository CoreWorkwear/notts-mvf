import { loadEnv } from 'vite'

// A signed-in, approved player with no backend behind them: real build, real CSS,
// real browser, stubbed Supabase. For checks that need the signed-in app but not
// real data (layout, stacking, what a tap lands on), so they can run in CI, where
// the live-creds layer (authed.spec.js) is skipped.
//
// The build talks to whatever VITE_SUPABASE_URL it was built with. Resolve it the
// way `vite build` did (real env vars first, then the .env files) so the stub
// answers that origin and the seeded session sits under the key supabase-js
// reads. EVERY request to that origin is fulfilled here and none is passed
// through, so the fake token can't reach a real project even with a real .env.
//
// Specs using this need `test.use({ serviceWorkers: 'block' })`: page.route()
// can't see a request the service worker answers.

const SUPABASE_URL = loadEnv('production', process.cwd(), 'VITE_').VITE_SUPABASE_URL

const ID = {
  player: '00000000-0000-4000-8000-00000000e2e1',
  club: '00000000-0000-4000-8000-00000000c1b1',
  team: '00000000-0000-4000-8000-00000000c0aa',
  season: '00000000-0000-4000-8000-00000000500a',
}

export const STUB = {
  firstName: 'Test',
  lastName: 'Player',
  email: 'player@example.com',
  phone: '+447700900123', // Ofcom's reserved drama range: never a real number
}

const USER = {
  id: ID.player, aud: 'authenticated', role: 'authenticated', email: STUB.email,
  app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z',
}

const ROWS = {
  profiles: [{
    id: ID.player, club_id: ID.club, first_name: STUB.firstName, last_name: STUB.lastName,
    role: 'player', approved: true, active: true, is_player: true,
    positions: ['CM'], preferred: 'CM', photo_url: null, requested_teams: [],
  }],
  profile_private: [{
    profile_id: ID.player, email: STUB.email, phone: STUB.phone, dob: null, ec_name: null, ec_phone: null,
  }],
  team_memberships: [{ team_id: ID.team, teams: { key: 'community' } }],
  teams: [{ id: ID.team, club_id: ID.club, key: 'community', name: 'Community' }],
  clubs: [{ id: ID.club, name: 'Nottinghamshire MvF', crest_url: null }],
  seasons: [{ id: ID.season, club_id: ID.club, label: '2026/27', is_current: true }],
}

// supabase-js only checks a stored session's shape and expiry; nothing in the
// browser verifies the signature.
function session() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const exp = Math.floor(Date.now() / 1000) + 3600
  return {
    access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: ID.player, role: 'authenticated', aud: 'authenticated', exp })}.stub`,
    token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'stub-refresh-token', user: USER,
  }
}

// The app is on another origin, and supabase-js sends Authorization + apikey,
// so every request is preflighted: echo back what the browser asks to send.
function cors(req) {
  const h = req.headers()
  return {
    'access-control-allow-origin': h.origin ?? '*',
    'access-control-allow-headers': h['access-control-request-headers'] ?? '*',
    'access-control-allow-methods': 'GET, HEAD, POST, PATCH, PUT, DELETE, OPTIONS',
    'access-control-expose-headers': 'content-range, x-request-id',
  }
}

async function answer(route) {
  const req = route.request()
  const headers = cors(req)
  const method = req.method()
  const { pathname } = new URL(req.url())
  if (method === 'OPTIONS') return route.fulfill({ status: 204, headers })
  if (pathname.startsWith('/auth/v1/user')) return route.fulfill({ headers, json: USER })
  if (pathname.startsWith('/auth/v1/')) return route.fulfill({ headers, json: session() })

  const table = pathname.match(/^\/rest\/v1\/([^/]+)/)?.[1]
  // Writes succeed with nothing to say (PostgREST's return=minimal); storage and
  // functions have nothing to serve.
  if (!table || (method !== 'GET' && method !== 'HEAD')) return route.fulfill({ status: 204, headers })

  const rows = ROWS[table] ?? []
  // .single() asks for one object, and PostgREST refuses unless there is exactly one.
  if ((req.headers().accept ?? '').includes('vnd.pgrst.object')) {
    return rows.length === 1
      ? route.fulfill({ headers, json: rows[0] })
      : route.fulfill({ status: 406, headers, json: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } })
  }
  const range = rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0'
  return route.fulfill({ headers: { ...headers, 'content-range': range }, json: rows })
}

// Call before the first page.goto().
export async function signInAsStubPlayer(page) {
  if (!SUPABASE_URL) throw new Error('VITE_SUPABASE_URL is not set, so the build has no Supabase origin to stub.')
  const url = new URL(SUPABASE_URL)
  const storageKey = `sb-${url.hostname.split('.')[0]}-auth-token`
  await page.addInitScript(([key, value]) => {
    try { localStorage.setItem(key, value) } catch { /* storage blocked: the spec will fail loudly at sign-in */ }
  }, [storageKey, JSON.stringify(session())])
  await page.route(`${url.origin}/**`, answer)
}
