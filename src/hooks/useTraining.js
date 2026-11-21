import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { hasKickedOff } from '../lib/format'
import { resolveVenuePostcode } from '../lib/venuePostcode'

const SESSION_FIELDS = 'id,club_id,start_date,start_time,venue,town,address,postcode,w3w,venue_lat,venue_lng,audience,focus,cancelled,revision,series_id'
const PAGE_SIZE = 300
const empty = { sessions: [], replies: {} }

async function result(query) {
  const { data, error } = await query
  if (error) throw error
  return data
}

export function useTraining() {
  const { user, profile, teamKeys } = useAuth()
  const userId = user?.id
  const clubId = profile?.club_id
  const identity = userId && clubId ? userId + '/' + clubId : null
  const [state, setState] = useState({})
  const request = useRef(0)
  const reload = useCallback(async () => {
    const version = ++request.current
    if (!identity) return false
    try {
      const sessions = []
      const replies = {}
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const rows = await result(supabase.from('training_sessions')
          .select(SESSION_FIELDS + ',training_replies(profile_id,status)')
          .eq('club_id', clubId).eq('training_replies.profile_id', userId)
          .order('start_date').order('start_time').order('id').range(offset, offset + PAGE_SIZE - 1))
        if (version !== request.current) return false
        for (const { training_replies, ...session } of rows) {
          sessions.push(session)
          if (training_replies?.[0]) replies[session.id] = training_replies[0].status
        }
        if (rows.length < PAGE_SIZE) break
      }
      setState({ identity, sessions, replies, error: null })
      return { sessions, replies }
    } catch (error) {
      if (version === request.current) setState(old => ({ ...(old.identity === identity ? old : empty), identity, error }))
      return false
    }
  }, [identity, clubId, userId])
  useEffect(() => {
    reload()
    const refresh = () => { if (!document.hidden) reload() }
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      request.current++
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [reload])
  const loaded = Boolean(identity && state.identity === identity)
  const data = loaded ? state : empty
  const eligible = Boolean(profile?.approved && profile?.active && profile?.is_player)
  const sessions = data.sessions.map(s => ({
    ...s,
    canReply: eligible && (s.audience === 'club' || (teamKeys || []).includes(s.audience)),
    openForReplies: !s.cancelled && !hasKickedOff(s.start_date, s.start_time),
  }))
  return { sessions, replies: data.replies, loading: !loaded, error: data.error, reload }
}

async function venueParams(fields, existing) {
  const location = await resolveVenuePostcode(fields.postcode ?? existing?.postcode, existing)
  return {
    p_address: (fields.address ?? existing?.address)?.trim() || null,
    p_postcode: location.postcode,
    p_w3w: (fields.w3w ?? existing?.w3w)?.trim() || null,
    p_venue_lat: location.venue_lat,
    p_venue_lng: location.venue_lng,
  }
}

export async function createTrainingSessions({ requestId, date, time, venue, town, audience, focus, recurrence, ...location }) {
  const rule = recurrence ?? { frequency: 'once', interval: 1, weekdays: [], count: 1, until: null }
  return result(supabase.rpc('create_training_series', {
    p_request_id: requestId, p_date: date, p_time: time, p_venue: venue, p_town: town,
    p_audience: audience, p_focus: focus, p_frequency: rule.frequency, p_interval: rule.interval,
    p_weekdays: rule.weekdays, p_until: rule.until, p_count: rule.count,
    ...await venueParams(location),
  }))
}

export function replyToTraining(session, status) {
  return result(supabase.rpc('reply_to_training', { p_session_id: session.id, p_revision: session.revision, p_status: status }))
}

export function getTrainingHeadcount(id) {
  return result(supabase.rpc('training_headcount', { p_session_id: id }))
}

export async function changeTrainingSession(session, { requestId, date, time, venue, town, focus, cancel, ...location }) {
  await result(supabase.rpc('change_training_session_venue', {
    p_session_id: session.id, p_revision: session.revision, p_request_id: requestId, p_date: date,
    p_time: time, p_venue: venue, p_town: town, p_focus: focus, p_cancel: Boolean(cancel),
    ...await venueParams(location, session),
  }))
  window.dispatchEvent(new Event('mvf-training-updated'))
}
