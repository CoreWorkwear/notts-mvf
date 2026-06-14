import { StrictMode, useState } from 'react'
import { describe, test, expect, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Sheet from './Sheet'

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 60)) })

// Mirrors the real Fixtures flow: a detail sheet open, and a button that closes
// it AND opens a second sheet in the same handler (detail → "Log the result").
function TwoSheets() {
  const [a, setA] = useState(true)
  const [b, setB] = useState(false)
  return (
    <>
      <Sheet open={a} onClose={() => setA(false)}>
        <div>SHEET A</div>
        <button onClick={() => { setA(false); setB(true) }}>transition</button>
      </Sheet>
      <Sheet open={b} onClose={() => setB(false)}><div>SHEET B</div></Sheet>
    </>
  )
}

function OneSheet() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>open</button>
      <Sheet open={open} onClose={() => setOpen(false)}><div>THE SHEET</div></Sheet>
    </>
  )
}

describe('Sheet / useSheetBack', () => {
  test('REGRESSION: opening a sheet while closing another keeps the new sheet open', async () => {
    render(<StrictMode><TwoSheets /></StrictMode>)
    expect(screen.getByText('SHEET A')).toBeInTheDocument()

    await userEvent.click(screen.getByText('transition'))
    await flush() // let any history.back()-driven popstate settle

    expect(screen.queryByText('SHEET A')).not.toBeInTheDocument()
    expect(screen.queryByText('SHEET B')).toBeInTheDocument() // must NOT have snapped shut
  })

  test('hardware back closes the open sheet (not the app)', async () => {
    render(<OneSheet />)
    await userEvent.click(screen.getByText('open'))
    expect(screen.getByText('THE SHEET')).toBeInTheDocument()

    await act(async () => { window.history.back(); await new Promise((r) => setTimeout(r, 60)) })
    expect(screen.queryByText('THE SHEET')).not.toBeInTheDocument()
  })

  // The deterministic root-cause guard: closing a sheet programmatically must
  // NOT call window.history.back(). That call is what fires a popstate caught by
  // a sibling sheet's listener during a detail→result transition (the flash).
  test('REGRESSION: closing a sheet does not call history.back()', async () => {
    const backSpy = vi.spyOn(window.history, 'back')
    function H() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>open</button>
          <button onClick={() => setOpen(false)}>close</button>
          <Sheet open={open} onClose={() => setOpen(false)}><div>S</div></Sheet>
        </>
      )
    }
    render(<H />)
    await userEvent.click(screen.getByText('open'))
    backSpy.mockClear()
    await userEvent.click(screen.getByText('close'))
    await flush()
    expect(backSpy).not.toHaveBeenCalled()
    backSpy.mockRestore()
  })

  test('a parent re-render does not close an open sheet', async () => {
    function Rerenderer() {
      const [, setTick] = useState(0)
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>open</button>
          <button onClick={() => setTick((t) => t + 1)}>rerender</button>
          {/* fresh inline onClose each render — must not tear the sheet down */}
          <Sheet open={open} onClose={() => setOpen(false)}><div>STABLE SHEET</div></Sheet>
        </>
      )
    }
    render(<Rerenderer />)
    await userEvent.click(screen.getByText('open'))
    expect(screen.getByText('STABLE SHEET')).toBeInTheDocument()

    await userEvent.click(screen.getByText('rerender'))
    await flush()
    expect(screen.queryByText('STABLE SHEET')).toBeInTheDocument()
  })
})
