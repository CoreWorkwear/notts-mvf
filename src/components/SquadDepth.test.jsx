import { describe, test, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import SquadDepth from './SquadDepth'

const make = (o) => ({ active: true, approved: true, is_player: true, positions: [], preferred: null, photo_url: null, ...o })

const PLAYERS = [
  make({ id: 'cb1', first_name: 'Nathan', last_name: 'Brown', preferred: 'CB', positions: ['CB', 'RB'] }),
  make({ id: 'cb2', first_name: 'Adam', last_name: 'Young', preferred: 'CB', positions: ['CB'] }),
  make({ id: 'rbCover', first_name: 'Ray', last_name: 'Cover', preferred: 'RB', positions: ['RB', 'CB'] }), // covers CB
  make({ id: 'gk', first_name: 'Gordon', last_name: 'Banks', preferred: 'GK', positions: ['GK'] }),
]

function renderDepth() {
  const r = render(<SquadDepth players={PLAYERS} />)
  // jsdom has no pointer capture; the pitch's tap handler calls it.
  r.container.querySelectorAll('[data-slot]').forEach((el) => { if (!el.setPointerCapture) el.setPointerCapture = () => {} })
  return r
}

const tapPos = (container, pos) => {
  const shirt = [...container.querySelectorAll('[data-slot]')].find((s) => s.querySelector('.shirt-pos')?.textContent === pos)
  fireEvent.pointerDown(shirt, { clientX: 10, clientY: 10, pointerId: 1 })
  fireEvent.pointerUp(shirt, { clientX: 11, clientY: 10, pointerId: 1 }) // no real move = a tap
  return shirt
}

describe('SquadDepth (§4.2)', () => {
  test('the pitch shows EVERY position (not a formation) — all 13', () => {
    const { container } = renderDepth()
    const positions = [...container.querySelectorAll('.shirt-pos')].map((s) => s.textContent)
    expect(positions).toHaveLength(13)
    expect([...positions].sort()).toEqual(['CAM', 'CB', 'CDM', 'CF', 'CM', 'GK', 'LB', 'LM', 'LW', 'RB', 'RM', 'RW', 'ST'])
    // Rendered attack-line first, keeper last (pitch orientation).
    expect(positions[positions.length - 1]).toBe('GK')
    // no formation selector
    expect(screen.queryByText(/^4-3-3/)).not.toBeInTheDocument()
  })

  test('starts with a hint and no list until a position is tapped', () => {
    renderDepth()
    expect(screen.getByText(/tap a position/i)).toBeInTheDocument()
    expect(document.querySelector('.sd-row')).toBeNull()
  })

  test('tapping a position lists who can play it — preferred first, then cover', () => {
    const { container } = renderDepth()
    tapPos(container, 'CB')
    expect(screen.getByText('Centre-backs')).toBeInTheDocument()
    const rows = [...document.querySelectorAll('.sd-row')]
    // Two preferred CBs (Brown, Young) then the cover (Cover).
    expect(rows.map((r) => r.querySelector('.sd-name').textContent)).toEqual(['Nathan Brown', 'Adam Young', 'Ray Cover'])
    // Tags: preferred ones say Preferred, the coverer says Can play.
    expect(within(rows[0]).getByText('Preferred')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Can play')).toBeInTheDocument()
  })

  test('cards are a clean line — no per-player positions list (the noisy bit)', () => {
    const { container } = renderDepth()
    tapPos(container, 'CB')
    expect(document.querySelector('.sd-meta')).toBeNull()
  })
})
