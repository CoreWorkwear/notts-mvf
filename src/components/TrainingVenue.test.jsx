import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { addDaysISO, todayISO } from '../lib/format'
import { TrainingSessionCard, TrainingVenueDetails } from './TrainingVenue'

const session = {
  id: 'training-venue-test', start_date: addDaysISO(todayISO(), 2), start_time: '19:00:00',
  venue: 'Club pitch', town: 'Nottingham', address: '1 Trent Road', postcode: 'NG2 5FJ',
}
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

test('a card with a postcode and no coordinates still offers a route without opening the session', () => {
  const lookup = vi.fn()
  vi.stubGlobal('fetch', lookup)
  render(<TrainingSessionCard session={session} audience="Community" status="View session" />)
  const route = screen.getByRole('link', { name: 'Get directions' })
  expect(new URL(route.href).searchParams.get('destination')).toBe('Club pitch, 1 Trent Road, Nottingham, NG2 5FJ')
  expect(route.closest('button')).toBeNull()
  expect(screen.getByText('NG2 5FJ')).toBeVisible()
  expect(lookup).not.toHaveBeenCalled()
})

test('the forecast uses the session’s hour and venue, and disappears when moved beyond range', async () => {
  const date = session.start_date
  const lookup = vi.fn(async () => ({ json: async () => ({ hourly: {
    time: [date + 'T19:00'], weather_code: [0], temperature_2m: [9], apparent_temperature: [7], precipitation_probability: [5], wind_speed_10m: [6],
  } }) }))
  vi.stubGlobal('fetch', lookup)
  const located = { ...session, venue_lat: 52.94, venue_lng: -1.14 }
  const props = { audience: 'Community', status: 'View session' }
  const view = render(<TrainingSessionCard session={located} {...props} />)
  expect(await screen.findByRole('group', { name: /Training forecast, Clear at 19:00/ })).toHaveTextContent('9°')
  const url = new URL(lookup.mock.calls[0][0])
  expect(url.searchParams.get('longitude')).toBe('-1.14')
  expect(url.searchParams.get('timezone')).toBe('Europe/London')
  view.rerender(<TrainingSessionCard session={{ ...located, start_date: addDaysISO(todayISO(), 21) }} {...props} />)
  await waitFor(() => expect(screen.queryByRole('group')).toBeNull())
  expect(lookup).toHaveBeenCalledTimes(1)
})

test('venue details expose what3words and a map for the booked ground', async () => {
  render(<TrainingVenueDetails session={{ ...session, cancelled: true, w3w: '///one.two.three', venue_lat: 52.94, venue_lng: -1.14 }} />)
  expect(screen.getByRole('link', { name: '///one.two.three' })).toHaveAttribute('href', 'https://what3words.com/one.two.three')
  await userEvent.click(screen.getByText('Venue map'))
  expect(await screen.findByTitle('Map of Club pitch')).toHaveAttribute('src', expect.stringContaining('marker=52.94%2C-1.14'))
  expect(screen.queryByRole('region', { name: 'Training forecast' })).toBeNull()
})
