import { describe, test, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OpponentForm from './OpponentForm'

// OpponentForm pulls in ImageUpload → lib/storage → supabase; stub it.
vi.mock('../lib/supabase', () => ({ supabase: {} }))

describe('OpponentForm', () => {
  test('quick add: name only saves with sensible defaults', async () => {
    const onSave = vi.fn().mockResolvedValue()
    const onClose = vi.fn()
    render(<OpponentForm open opponent={null} onSave={onSave} onClose={onClose} />)

    await userEvent.type(screen.getByPlaceholderText(/Carlton Town/i), 'Long Eaton')
    await userEvent.click(screen.getByRole('button', { name: /add opponent/i }))

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0]).toMatchObject({ name: 'Long Eaton', is_league_team: false })
  })

  test('edit prefills the existing opponent', async () => {
    render(<OpponentForm open onSave={vi.fn()} onClose={vi.fn()}
      opponent={{ id: 'o1', name: 'Carlton Town', home_venue: 'Stoke Lane', is_league_team: true, badge_url: null }} />)
    expect(screen.getByDisplayValue('Carlton Town')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Stoke Lane')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /league team/i })).toHaveAttribute('aria-pressed', 'true')
  })

  test('name is required — blocks save, flags the field, pops an error', async () => {
    const onSave = vi.fn()
    render(<OpponentForm open opponent={null} onSave={onSave} onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /add opponent/i }))

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/name/i)
    expect(screen.getByPlaceholderText(/Carlton Town/i)).toHaveAttribute('aria-invalid', 'true')
  })
})
