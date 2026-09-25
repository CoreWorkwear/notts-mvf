import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AvailControl from './AvailControl'
import { PATTERNS } from '../lib/haptics'

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

beforeEach(() => {
  window.localStorage.clear()
  Object.defineProperty(navigator, 'vibrate', { value: vi.fn(), configurable: true, writable: true })
})

describe('AvailControl — only a write that actually landed is announced', () => {
  // Fixtures.handleSetAvail resolves `false` (by design, not a throw) when the
  // write failed after retrying. The buzz must never say "done" for something
  // that did not land — for a player who tapped and pocketed the phone, the
  // haptic is the only signal they get without looking.
  test('onChange resolving false → no "Saved ✓", and the WARN pattern, never confirm', async () => {
    const onChange = vi.fn().mockResolvedValue(false)
    render(<AvailControl value={null} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: "I'm in" }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('in'))
    await tick()
    expect(screen.queryByText('Saved ✓')).not.toBeInTheDocument()
    expect(navigator.vibrate).toHaveBeenCalledWith(PATTERNS.warn)
    expect(navigator.vibrate).not.toHaveBeenCalledWith(PATTERNS.confirm)
    // buttons are re-enabled for another go
    expect(screen.getByRole('button', { name: "I'm in" })).toBeEnabled()
  })

  test('onChange resolving normally → "Saved ✓" and the confirm pattern', async () => {
    const onChange = vi.fn().mockResolvedValue(undefined)
    render(<AvailControl value={null} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: "I'm in" }))
    expect(await screen.findByText('Saved ✓')).toBeInTheDocument()
    expect(navigator.vibrate).toHaveBeenCalledWith(PATTERNS.confirm)
  })

  // Marking yourself in is the good news; maybe and out are acknowledgements.
  test('maybe / out get the lighter tap, not the confirm', async () => {
    const onChange = vi.fn().mockResolvedValue(undefined)
    render(<AvailControl value={null} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /can't make it/i }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('out'))
    await tick()
    expect(navigator.vibrate).toHaveBeenCalledWith(PATTERNS.tap)
    expect(navigator.vibrate).not.toHaveBeenCalledWith(PATTERNS.confirm)
  })

  // Haptics are decorative by contract — the visible state is the real signal.
  test('with haptics switched off the control still announces the save', async () => {
    window.localStorage.setItem('mvf-haptics', 'off')
    const onChange = vi.fn().mockResolvedValue(undefined)
    render(<AvailControl value={null} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: "I'm in" }))
    expect(await screen.findByText('Saved ✓')).toBeInTheDocument()
    expect(navigator.vibrate).not.toHaveBeenCalled()
  })
})
