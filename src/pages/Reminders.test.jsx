import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const save = vi.fn().mockResolvedValue({ error: null })
let mockSettings = { club_id: 'c1', enabled: true, offsets: [48, 24] }
vi.mock('../hooks/useReminders', () => ({
  useReminders: () => ({ settings: mockSettings, loading: false, save, refetch: vi.fn() }),
}))

import Reminders from './Reminders'

beforeEach(() => {
  save.mockClear()
  mockSettings = { club_id: 'c1', enabled: true, offsets: [48, 24] }
})

describe('Reminders page', () => {
  test('saves the current on/offsets config', async () => {
    render(<Reminders />)
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ enabled: true, offsets: [48, 24] }))
  })

  test('toggling an offset on includes it in the saved set (newest-first)', async () => {
    render(<Reminders />)
    await userEvent.click(screen.getByRole('button', { name: /3 hours before/i }))
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ enabled: true, offsets: [48, 24, 3] }))
  })

  test('blocks saving when on with no times picked', async () => {
    mockSettings = { club_id: 'c1', enabled: true, offsets: [24] }
    render(<Reminders />)
    await userEvent.click(screen.getByRole('button', { name: /1 day before/i })) // turn the only offset off
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least one reminder time/i)
    expect(save).not.toHaveBeenCalled()
  })
})
