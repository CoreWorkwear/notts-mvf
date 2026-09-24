import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

let media
vi.mock('../hooks/useMedia', () => ({ useMedia: () => media }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ club: { crest_url: null } }) }))
// Stand-in uploader: the real one resizes + uploads to Storage, then hands the
// public URL to onUploaded — that hand-off is all MediaPanel's behaviour needs.
vi.mock('./ImageUpload', () => ({
  default: ({ onUploaded, label }) => <button type="button" onClick={() => onUploaded('https://cdn/x.jpg')}>{label}</button>,
}))

import MediaPanel from './MediaPanel'

beforeEach(() => {
  media = {
    photos: [{ id: 'm1', url: 'https://cdn/a.jpg' }],
    loading: false,
    addPhoto: vi.fn(async () => ({ error: null })),
    removePhoto: vi.fn(async () => ({ error: null })),
    setCrest: vi.fn(async () => ({ error: null })),
  }
})

// A failed media write used to be an unhandled rejection — the upload "worked"
// as far as the manager could see, but the photo never joined the pool.
describe('MediaPanel — surfaces a failed media write', () => {
  test('a photo that uploads but cannot be added to the pool shows a toast', async () => {
    media.addPhoto = vi.fn(async () => ({ error: { message: 'RLS said no', code: '42501' } }))
    render(<MediaPanel />)
    await userEvent.click(screen.getByRole('button', { name: /add club photos/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/couldn't add/i))
  })

  test('a photo that cannot be removed shows a toast', async () => {
    media.removePhoto = vi.fn(async () => ({ error: { message: 'nope' } }))
    render(<MediaPanel />)
    await userEvent.click(screen.getByRole('button', { name: /remove photo/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/couldn't remove/i))
  })

  test('a crest that uploads but cannot be saved shows a toast', async () => {
    media.setCrest = vi.fn(async () => ({ error: { message: 'nope' } }))
    render(<MediaPanel />)
    await userEvent.click(screen.getByRole('button', { name: /upload crest/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/crest/i))
  })

  test('a successful add shows no alert', async () => {
    render(<MediaPanel />)
    await userEvent.click(screen.getByRole('button', { name: /add club photos/i }))
    await waitFor(() => expect(media.addPhoto).toHaveBeenCalledWith('https://cdn/x.jpg'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
