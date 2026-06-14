import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PlayerForm from './PlayerForm'

const h = vi.hoisted(() => ({ calls: [] }))
vi.mock('../lib/supabase', () => {
  const qb = (table) => {
    const b = { then: (r) => Promise.resolve({ data: [], error: null }).then(r) }
    ;['select', 'eq', 'neq', 'in', 'order'].forEach((m) => { b[m] = () => b })
    b.update = (payload) => { h.calls.push(['update', table, payload]); return b }
    b.delete = () => { h.calls.push(['delete', table]); return b }
    b.insert = (rows) => { h.calls.push(['insert', table, rows]); return b }
    return b
  }
  return {
    supabase: { from: (t) => qb(t), auth: { resetPasswordForEmail: () => Promise.resolve({ error: null }) } },
    makeSignupClient: () => ({ auth: { signUp: () => Promise.resolve({ error: null }) } }),
  }
})

const TEAMS = [{ id: 't-xl', key: 'xl', label: 'XL 11s' }, { id: 't-co', key: 'community', label: 'Community' }]
const PLAYER = {
  id: 'p1', first_name: 'Joe', last_name: 'Morris', email: 'joe@notts.test', phone: '07700900000',
  dob: null, ec_name: null, ec_phone: null, positions: [], preferred: null,
  role: 'player', xl_eligible: false, active: true, teamKeys: ['xl'], teamIds: ['t-xl'],
}

beforeEach(() => { h.calls.length = 0 })

describe('PlayerForm', () => {
  test('edit saves changed fields to profiles', async () => {
    const onSaved = vi.fn()
    render(<PlayerForm open onClose={() => {}} onSaved={onSaved} player={PLAYER} teams={TEAMS} currentUserId="admin" />)

    const firstName = screen.getByDisplayValue('Joe')
    await userEvent.clear(firstName)
    await userEvent.type(firstName, 'Joey')
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const upd = h.calls.find((c) => c[0] === 'update' && c[1] === 'profiles')
    expect(upd).toBeTruthy()
    expect(upd[2]).toMatchObject({ first_name: 'Joey', email: 'joe@notts.test' })
  })

  test('an admin cannot demote or deactivate their own row', async () => {
    render(<PlayerForm open onClose={() => {}} onSaved={() => {}} player={{ ...PLAYER, role: 'admin' }} teams={TEAMS} currentUserId="p1" />)
    expect(screen.getByText(/can't change your own role/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Active' })).toBeDisabled()
  })
})
