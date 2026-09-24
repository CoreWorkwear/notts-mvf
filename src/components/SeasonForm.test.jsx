import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SeasonForm from './SeasonForm'

describe('SeasonForm — the "current season" switch', () => {
  // Un-ticking it on the season that IS current was a silent no-op (nothing
  // else becomes current). Lock it and say why instead.
  test('editing the current season: the chip is locked, with a hint', () => {
    render(<SeasonForm open season={{ id: 's1', label: '2025/26', is_current: true }} onClose={() => {}} onSave={vi.fn()} />)
    const chip = screen.getByRole('button', { name: /current season ✓/i })
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(chip).toBeDisabled()
    expect(screen.getByText(/set another season as current/i)).toBeInTheDocument()
  })

  test('editing a past season: the chip can still be ticked to roll over to it', async () => {
    render(<SeasonForm open season={{ id: 's0', label: '2024/25', is_current: false }} onClose={() => {}} onSave={vi.fn()} />)
    const chip = screen.getByRole('button', { name: /make this the current season/i })
    expect(chip).toBeEnabled()
    await userEvent.click(chip)
    expect(screen.getByRole('button', { name: /current season ✓/i })).toHaveAttribute('aria-pressed', 'true')
  })

  test('a new season defaults to becoming current and can be un-ticked', async () => {
    render(<SeasonForm open season={null} onClose={() => {}} onSave={vi.fn()} />)
    const chip = screen.getByRole('button', { name: /current season ✓/i })
    expect(chip).toBeEnabled()
    await userEvent.click(chip)
    expect(screen.getByRole('button', { name: /make this the current season/i })).toBeInTheDocument()
  })
})
