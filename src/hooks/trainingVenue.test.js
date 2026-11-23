import { afterEach, describe, expect, test, vi } from 'vitest'
import { changeTrainingSession, createTrainingSessions } from './useTraining'
import { supabase } from '../lib/supabase'

vi.mock('../lib/supabase', () => ({ supabase: { rpc: vi.fn(async () => ({ data: 'first-session' })) } }))
const booking = { date: '2027-03-01', time: '19:00', venue: 'Club pitch', town: 'Nottingham', audience: 'club', focus: 'Passing', requestId: 'req' }
const existing = { id: 's1', revision: 2, address: '1 Trent Road', postcode: 'NG2 5FJ', venue_lat: 52.94, venue_lng: -1.14, w3w: 'one.two.three' }

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals() })

describe('training venue and recurring booking writes', () => {
  test('geocodes a series once and sends its selected weekdays and end condition', async () => {
    const lookup = vi.fn(async () => ({ ok: true, json: async () => ({ result: { latitude: 52.94, longitude: -1.14 } }) }))
    vi.stubGlobal('fetch', lookup)
    await expect(createTrainingSessions({ ...booking, address: '1 Trent Road ', postcode: 'ng25fj', recurrence: {
      frequency: 'week', interval: 2, weekdays: [1, 3], count: 5, until: null,
    } })).resolves.toBe('first-session')
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(supabase.rpc).toHaveBeenCalledWith('create_training_series', expect.objectContaining({
      p_frequency: 'week', p_weekdays: [1, 3], p_interval: 2, p_count: 5, p_until: null,
      p_address: '1 Trent Road', p_postcode: 'NG2 5FJ', p_venue_lat: 52.94, p_venue_lng: -1.14,
    }))
  })

  test('saves a single session with the typed postcode if lookup is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await createTrainingSessions({ ...booking, postcode: 'ng25fj' })
    expect(supabase.rpc).toHaveBeenCalledWith('create_training_series', expect.objectContaining({
      p_frequency: 'once', p_count: 1, p_postcode: 'NG2 5FJ', p_venue_lat: null, p_venue_lng: null,
    }))
  })

  test('a cancellation retains the address and coordinates, and removing a postcode clears both coordinates', async () => {
    const lookup = vi.fn()
    vi.stubGlobal('fetch', lookup)
    await changeTrainingSession(existing, { ...booking, cancel: true })
    expect(supabase.rpc).toHaveBeenLastCalledWith('change_training_session_venue', expect.objectContaining({
      p_session_id: 's1', p_revision: 2, p_cancel: true, p_address: existing.address, p_postcode: existing.postcode,
      p_w3w: existing.w3w, p_venue_lat: existing.venue_lat, p_venue_lng: existing.venue_lng,
    }))
    await changeTrainingSession(existing, { ...booking, postcode: '', address: '', w3w: '' })
    expect(supabase.rpc).toHaveBeenLastCalledWith('change_training_session_venue', expect.objectContaining({
      p_cancel: false, p_postcode: null, p_address: null, p_w3w: null, p_venue_lat: null, p_venue_lng: null,
    }))
    expect(lookup).not.toHaveBeenCalled()
  })
})
