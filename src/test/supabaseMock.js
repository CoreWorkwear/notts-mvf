import { vi } from 'vitest'

// A reusable, store-driven stand-in for the Supabase client so tests stop
// hand-rolling chainable mocks. Every `from(table)` query is thenable and
// resolves to `{ data, error }` from `tables[table]`; writes are recorded.
//
//   const sb = makeSupabaseMock({ fixtures: [...] })
//   vi.mock('../lib/supabase', () => ({ supabase: sb.client }))   // hoisted: build sb via vi.hoisted
//   sb.failWith('fixtures', { message: 'RLS said no', code: '42501' }) // response-level error
//   sb.rejectWith('fixtures', new TypeError('Load failed'))             // network-level reject
//   sb.calls   → [{ table, ops: ['select', 'eq', ...], payload }]
//   sb.writes  → the insert/upsert/update/delete payloads, in order
//
// Filters are NOT applied (set precise table data per test); single()/
// maybeSingle() return the first row / null.
export function makeSupabaseMock(tables = {}) {
  const state = { tables, errors: {}, rejects: {}, calls: [], writes: [], session: null }

  const from = (table) => {
    const call = { table, ops: [], payload: null }
    state.calls.push(call)
    let single = false
    const q = {
      then(onF, onR) {
        let p
        if (state.rejects[table]) p = Promise.reject(state.rejects[table])
        else if (state.errors[table]) p = Promise.resolve({ data: null, error: state.errors[table] })
        else {
          const rows = state.tables[table] ?? []
          const data = single ? (rows[0] ?? null) : rows
          p = Promise.resolve({ data, error: null, count: rows.length })
        }
        return p.then(onF, onR)
      },
    }
    ;['select', 'eq', 'neq', 'in', 'is', 'not', 'gte', 'lte', 'gt', 'lt', 'like', 'ilike', 'order', 'limit', 'range', 'match', 'or', 'filter']
      .forEach((m) => { q[m] = (...args) => { call.ops.push(m); call.args = call.args ?? []; call.args.push([m, ...args]); return q } })
    ;['single', 'maybeSingle'].forEach((m) => { q[m] = () => { call.ops.push(m); single = true; return q } })
    ;['insert', 'upsert', 'update', 'delete'].forEach((m) => {
      q[m] = (payload) => { call.ops.push(m); call.payload = payload ?? null; state.writes.push({ table, op: m, payload: payload ?? null }); return q }
    })
    return q
  }

  const client = {
    from,
    auth: {
      getSession: vi.fn(async () => ({ data: { session: state.session }, error: null })),
      getUser: vi.fn(async () => ({ data: { user: state.session?.user ?? null }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
      signOut: vi.fn(async () => ({ error: null })),
    },
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
    storage: { from: () => ({ upload: vi.fn(async () => ({ data: {}, error: null })), getPublicUrl: () => ({ data: { publicUrl: 'https://cdn/x.jpg' } }) }) },
  }

  return {
    client,
    get calls() { return state.calls },
    get writes() { return state.writes },
    setTables(t) { state.tables = t },
    setSession(s) { state.session = s },
    failWith(table, error) { state.errors[table] = error },
    rejectWith(table, err) { state.rejects[table] = err },
    reset(t = {}) { state.tables = t; state.errors = {}; state.rejects = {}; state.calls.length = 0; state.writes.length = 0 },
  }
}
