import { describe, test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PitchView from './PitchView'

const base = { formation: '4-4-2', starters: { 0: 'p1' }, names: { p1: 'Joe Bloggs' } }

describe('PitchView', () => {
  test('shows the headshot, first name and surname when a photo exists', () => {
    render(<PitchView {...base} photos={{ p1: 'https://img/joe.png' }} />)
    expect(screen.getByText('Joe')).toBeInTheDocument()
    expect(screen.getByText('Bloggs')).toBeInTheDocument()
    expect(document.querySelector('img.shirt-photo')).toHaveAttribute('src', 'https://img/joe.png')
  })

  test('falls back to initials when there is no photo', () => {
    render(<PitchView {...base} />)
    expect(screen.getByText('JB')).toBeInTheDocument()
    expect(document.querySelector('img.shirt-photo')).toBeNull()
    expect(screen.getByText('Bloggs')).toBeInTheDocument()
  })

  test('a single-token name sits on the surname line', () => {
    render(<PitchView formation="4-4-2" starters={{ 0: 'p1' }} names={{ p1: 'Pelé' }} />)
    expect(screen.getByText('Pelé')).toBeInTheDocument()
  })
})

// Regression for the line-up drag-and-drop (the buggy/clunky swapping). jsdom
// can't model native touch (that's the touch-action CSS fix, proven in-browser),
// but we lock the POINTER LOGIC: a drag onto another slot swaps; a tap opens the
// picker; dropping on itself or a cancel does neither.
describe('PitchView drag-and-drop', () => {
  const NAMES = { a: 'Alan Ardley', b: 'Ben Best' }
  const slot = (c, n) => c.querySelector(`[data-slot="${n}"]`)
  afterEach(() => { delete document.elementFromPoint })

  function renderEditor() {
    const onSwap = vi.fn(); const onTapSlot = vi.fn()
    document.elementFromPoint = () => null // jsdom has none; tests that need a target override it
    const r = render(<PitchView formation="4-3-3" starters={{ 0: 'a', 5: 'b' }} names={NAMES} onTapSlot={onTapSlot} onSwap={onSwap} />)
    r.container.querySelectorAll('[data-slot]').forEach((el) => {
      if (!el.setPointerCapture) el.setPointerCapture = () => {}
    })
    return { ...r, onSwap, onTapSlot }
  }

  test('dragging a shirt onto another swaps them, and does NOT also open the picker', () => {
    const { container, onSwap, onTapSlot } = renderEditor()
    document.elementFromPoint = () => slot(container, 5)
    const s0 = slot(container, 0)
    fireEvent.pointerDown(s0, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(s0, { clientX: 90, clientY: 90, pointerId: 1 })
    fireEvent.pointerUp(s0, { clientX: 90, clientY: 90, pointerId: 1 })
    fireEvent.click(s0, { detail: 1 })
    expect(onSwap).toHaveBeenCalledWith(0, 5)
    expect(onTapSlot).not.toHaveBeenCalled()
  })

  test('a tap opens the picker on the native click, after the finger lifts', () => {
    const { container, onSwap, onTapSlot } = renderEditor()
    const s0 = slot(container, 0)
    fireEvent.pointerDown(s0, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(s0, { clientX: 12, clientY: 11, pointerId: 1 })
    expect(onTapSlot).not.toHaveBeenCalled()
    fireEvent.click(s0, { detail: 1 })
    expect(onTapSlot).toHaveBeenCalledWith(0, s0)
    expect(onSwap).not.toHaveBeenCalled()
  })

  test('keyboard and assistive technology activation opens a shirt without a pointer', () => {
    const { container, onTapSlot } = renderEditor()
    fireEvent.click(slot(container, 0), { detail: 0 })
    expect(onTapSlot).toHaveBeenCalledWith(0, slot(container, 0))
  })

  test('dropping back on the same slot does nothing', () => {
    const { container, onSwap, onTapSlot } = renderEditor()
    document.elementFromPoint = () => slot(container, 0)
    const s0 = slot(container, 0)
    fireEvent.pointerDown(s0, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(s0, { clientX: 90, clientY: 90, pointerId: 1 })
    fireEvent.pointerUp(s0, { clientX: 90, clientY: 90, pointerId: 1 })
    expect(onSwap).not.toHaveBeenCalled()
    expect(onTapSlot).not.toHaveBeenCalled()
  })

  test('a cancelled gesture clears state cleanly', () => {
    const { container, onSwap, onTapSlot } = renderEditor()
    const s0 = slot(container, 0)
    fireEvent.pointerDown(s0, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(s0, { clientX: 90, clientY: 90, pointerId: 1 })
    fireEvent.pointerCancel(s0, { pointerId: 1 })
    expect(onSwap).not.toHaveBeenCalled()
    expect(onTapSlot).not.toHaveBeenCalled()
  })

  test('swiping a touch across a filled shirt before the hold delay leaves both positions alone', () => {
    const { container, onSwap, onTapSlot } = renderEditor()
    const source = slot(container, 0)
    document.elementFromPoint = () => slot(container, 5)
    // jsdom has no native PointerEvent constructor. Provide touch identity
    // and mouse coordinates on the actual DOM events React will receive.
    function finger(type, x, y) {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y })
      Object.assign(event, { pointerId: 1, pointerType: 'touch', isPrimary: true })
      fireEvent(source, event)
    }
    finger('pointerdown', 40, 100)
    finger('pointermove', 41, 45)
    finger('pointerup', 41, 45)
    fireEvent.click(source, { detail: 1 })
    expect(onSwap).not.toHaveBeenCalled()
    expect(onTapSlot).not.toHaveBeenCalled()
  })
})
