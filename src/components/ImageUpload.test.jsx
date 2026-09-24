import { describe, test, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('../lib/storage', () => ({ uploadMedia: vi.fn() }))

import ImageUpload from './ImageUpload'

describe('ImageUpload — the preview follows `current`', () => {
  // FixtureForm reuses one ImageUpload for whichever opponent is picked: the
  // badge preview must switch with it, not stay on the previous opponent's.
  test('a new `current` replaces the preview; null clears it', () => {
    const { rerender, container } = render(<ImageUpload folder="opponents" current="https://cdn/a.png" onUploaded={() => {}} />)
    expect(container.querySelector('.iu-preview img')).toHaveAttribute('src', 'https://cdn/a.png')

    rerender(<ImageUpload folder="opponents" current="https://cdn/b.png" onUploaded={() => {}} />)
    expect(container.querySelector('.iu-preview img')).toHaveAttribute('src', 'https://cdn/b.png')

    rerender(<ImageUpload folder="opponents" current={null} onUploaded={() => {}} />)
    expect(container.querySelector('.iu-preview img')).toBeNull()
  })
})
