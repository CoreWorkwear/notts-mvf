import { describe, test, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import NewsForm from './NewsForm'

describe('NewsForm', () => {
  test('blocks an empty post', async () => {
    const onPost = vi.fn()
    render(<NewsForm open onClose={() => {}} onPost={onPost} />)
    await userEvent.click(screen.getByRole('button', { name: /post & notify/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/headline/i)
    expect(onPost).not.toHaveBeenCalled()
  })

  test('posts with push on by default', async () => {
    const onPost = vi.fn().mockResolvedValue()
    render(<NewsForm open onClose={() => {}} onPost={onPost} />)
    await userEvent.type(screen.getByLabelText('Headline'), 'Pitch change')
    await userEvent.type(screen.getByLabelText('Message'), 'On the 4G this week')
    await userEvent.click(screen.getByRole('button', { name: /post & notify/i }))
    await waitFor(() => expect(onPost).toHaveBeenCalledWith({ title: 'Pitch change', body: 'On the 4G this week', push: true }))
  })

  // The post went in but the push didn't go out: the composer must say so
  // rather than closing as if everyone had been pinged.
  test('tells the manager when the post landed but the push failed', async () => {
    const onPost = vi.fn().mockResolvedValue({ pushFailed: true })
    const onClose = vi.fn()
    render(<NewsForm open onClose={onClose} onPost={onPost} />)
    await userEvent.type(screen.getByLabelText('Headline'), 'Pitch change')
    await userEvent.type(screen.getByLabelText('Message'), 'On the 4G this week')
    await userEvent.click(screen.getByRole('button', { name: /post & notify/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(screen.getByRole('alert')).toHaveTextContent(/push didn't go out/i)
  })

  test('can post quietly without a push', async () => {
    const onPost = vi.fn().mockResolvedValue()
    render(<NewsForm open onClose={() => {}} onPost={onPost} />)
    await userEvent.type(screen.getByLabelText('Headline'), 'Minor note')
    await userEvent.type(screen.getByLabelText('Message'), 'No need to ping')
    await userEvent.click(screen.getByRole('button', { name: /push to everyone/i })) // toggle push off
    await userEvent.click(screen.getByRole('button', { name: /^post$/i }))
    await waitFor(() => expect(onPost).toHaveBeenCalledWith({ title: 'Minor note', body: 'No need to ping', push: false }))
  })
})
