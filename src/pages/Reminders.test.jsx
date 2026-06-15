import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const save = vi.fn().mockResolvedValue({ error: null })
let mockSettings
vi.mock('../hooks/useReminders', () => ({
  useReminders: () => ({ settings: mockSettings, loading: false, save, refetch: vi.fn() }),
}))

import Reminders from './Reminders'

const block = (title) => screen.getByText(title).closest('.card')
const toggleIn = (title) => within(block(title)).getByRole('button', { name: /^(On ✓|Off)$/ })

beforeEach(() => {
  save.mockClear()
  mockSettings = {
    club_id: 'c1', availability_enabled: true, match_enabled: false,
    availability_offsets: [336, 168, 72], match_offsets: [72, 24],
  }
})

describe('Reminders page — independent periods per type', () => {
  test('saves each type with its own offsets', async () => {
    render(<Reminders />)
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({
      availabilityEnabled: true, matchEnabled: false,
      availabilityOffsets: [336, 168, 72], matchOffsets: [72, 24],
    }))
  })

  test('a period change in one block does not affect the other', async () => {
    render(<Reminders />)
    // add "1 day" to availability only
    await userEvent.click(within(block('Availability nudges')).getByRole('button', { name: /1 day before/i }))
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
      availabilityOffsets: [336, 168, 72, 24], matchOffsets: [72, 24],
    })))
  })

  test('blocks saving a type that is on with no times', async () => {
    mockSettings = { ...mockSettings, match_enabled: false, match_offsets: [] }
    render(<Reminders />)
    await userEvent.click(toggleIn('Match reminders')) // turn match on, but it has no times
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/match reminders are on but have no times/i)
    expect(save).not.toHaveBeenCalled()
  })
})
