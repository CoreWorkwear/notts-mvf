import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const save = vi.fn().mockResolvedValue({ error: null })
let mockSettings
vi.mock('../hooks/useReminders', () => ({
  useReminders: () => ({ settings: mockSettings, loading: false, save, refetch: vi.fn() }),
}))

import Reminders from './Reminders'

const toggleFor = (label) => within(screen.getByText(label).closest('.row')).getByRole('button')

beforeEach(() => {
  save.mockClear()
  mockSettings = { club_id: 'c1', availability_enabled: true, match_enabled: false, offsets: [336, 168, 72] }
})

describe('Reminders page', () => {
  test('saves the two toggles + shared offsets', async () => {
    render(<Reminders />)
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ availabilityEnabled: true, matchEnabled: false, offsets: [336, 168, 72] }))
  })

  test('turning match reminders on is saved', async () => {
    render(<Reminders />)
    await userEvent.click(toggleFor('Match reminders'))
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ availabilityEnabled: true, matchEnabled: true, offsets: [336, 168, 72] }))
  })

  test('adding a discretionary 1-day nudge keeps the set sorted newest-first', async () => {
    render(<Reminders />)
    await userEvent.click(screen.getByRole('button', { name: /1 day before/i }))
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ availabilityEnabled: true, matchEnabled: false, offsets: [336, 168, 72, 24] }))
  })

  test('blocks saving when a type is on but no times are picked', async () => {
    mockSettings = { club_id: 'c1', availability_enabled: true, match_enabled: false, offsets: [24] }
    render(<Reminders />)
    await userEvent.click(screen.getByRole('button', { name: /1 day before/i })) // turn the only offset off
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least one reminder time/i)
    expect(save).not.toHaveBeenCalled()
  })
})
