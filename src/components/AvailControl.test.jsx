import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AvailControl from './AvailControl'

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

beforeEach(() => {
  Object.defineProperty(navigator, 'vibrate', { value: vi.fn(), configurable: true, writable: true })
})

describe('AvailControl — only a write that actually landed is announced', () => {
  // Fixtures.handleSetAvail resolves `false` (by design, not a throw) when the
  // write failed after retrying — no "Saved ✓", no haptic tick.
  test('onChange resolving false → no "Saved ✓", no vibrate', async () => {
    const onChange = vi.fn().mockResolvedValue(false)
    render(<AvailControl value={null} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: "I'm in" }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('in'))
    await tick()
    expect(screen.queryByText('Saved ✓')).not.toBeInTheDocument()
    expect(navigator.vibrate).not.toHaveBeenCalled()
    // buttons are re-enabled for another go
    expect(screen.getByRole('button', { name: "I'm in" })).toBeEnabled()
  })

  test('onChange resolving normally → "Saved ✓" and the haptic tick', async () => {
    const onChange = vi.fn().mockResolvedValue(undefined)
    render(<AvailControl value={null} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: "I'm in" }))
    expect(await screen.findByText('Saved ✓')).toBeInTheDocument()
    expect(navigator.vibrate).toHaveBeenCalled()
  })
})
