import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
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
