import { StrictMode, useState } from 'react'
import { describe, test, expect, vi } from 'vitest'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
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
  test('a refused grip dismissal returns to rest and the grip can dismiss again', async () => {
    let saving = true
    const requested = vi.fn()
    function SavingForm() {
      const [open, setOpen] = useState(true)
      return <Sheet open={open} onClose={() => {
        requested()
        if (!saving) setOpen(false)
      }}><h2>Save the line-up</h2></Sheet>
    }
    render(<SavingForm />)
    const dialog = screen.getByRole('dialog')
    const grip = screen.getByRole('button', { name: 'Close sheet' })
    fireEvent.click(grip)
    await waitFor(() => expect(requested).toHaveBeenCalledOnce(), { timeout: 2500 })
    await waitFor(() => expect(dialog.style.transform).toBe('none'), { timeout: 2500 })
    saving = false
    fireEvent.click(grip)
    await waitFor(() => expect(dialog).not.toBeInTheDocument(), { timeout: 2500 })
  })

  test('names the dialog, keeps the tab sequence inside it, and returns focus after Escape', async () => {
    function Editor() {
      const [open, setOpen] = useState(false)
      return <>
        <button onClick={() => setOpen(true)}>Edit the team</button>
        <Sheet open={open} onClose={() => setOpen(false)}>
          <h2>Team details</h2>
          <button data-sheet-focus>Pick player</button>
          <button>Save</button>
        </Sheet>
      </>
    }
    render(<Editor />)
    const opener = screen.getByRole('button', { name: 'Edit the team' })
    await userEvent.click(opener)
    expect(screen.getByRole('dialog', { name: 'Team details' })).toBeInTheDocument()
    const first = screen.getByRole('button', { name: 'Pick player' })
    expect(first).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Close sheet' })).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(screen.getByText('Save')).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Close sheet' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(opener).toHaveFocus()
  })

  test('fits the visible keyboard viewport and cleans up after closing', async () => {
    const viewport = Object.assign(new EventTarget(), { height: 370, offsetTop: 60, scale: 1 })
    vi.stubGlobal('visualViewport', viewport)
    try {
      render(<OneSheet />)
      await userEvent.click(screen.getByText('open'))
      const backdrop = screen.getByRole('dialog').parentElement
      expect(backdrop.style.getPropertyValue('--viewport-height')).toBe('370px')
      viewport.height = 320
      act(() => viewport.dispatchEvent(new Event('resize')))
      expect(backdrop.style.getPropertyValue('--viewport-height')).toBe('320px')
      expect(backdrop.style.getPropertyValue('--viewport-top')).toBe('60px')
    } finally {
      vi.unstubAllGlobals()
    }
  })

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

  test('returns focus to a tapped trigger even when Safari left focus on the page', async () => {
    render(<OneSheet />)
    const trigger = screen.getByRole('button', { name: 'open' })
    fireEvent.click(trigger) // no pointer focus, as on iOS
    await userEvent.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
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

  test('reopening a dismissed sheet reuses the existing history entry', async () => {
    render(<OneSheet />)
    const trigger = screen.getByRole('button', { name: 'open' })
    await userEvent.click(trigger)
    const length = history.length
    await userEvent.keyboard('{Escape}')
    await userEvent.click(trigger)
    expect(history.length).toBe(length)
  })
})
