import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { hasKickedOff } from '../lib/format'

const fields = 'id,title,body,kind,session_id,created_at,training_sessions(id,audience,cancelled,start_date,start_time)'
const PAGE = 5

function useNotices(limit) {
  const { user, profile } = useAuth()
  const identity = user?.id && profile?.club_id ? user.id + '/' + profile.club_id : null
  const [snapshot, setSnapshot] = useState({})
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt(n => n + 1), [])
  useEffect(() => {
    if (!identity) return
    let active = true
    let request = 0
    async function load() {
      if (document.hidden) return
      const current = ++request
      try {
        const { data, error } = await supabase.from('training_notices').select(fields)
          .eq('club_id', profile.club_id).order('created_at', { ascending: false })
          .order('id', { ascending: false }).limit(limit + 1)
        if (error) throw error
        if (active && current === request) setSnapshot({ identity, rows: data.slice(0, limit), more: data.length > limit })
      } catch (error) {
        if (active && current === request) setSnapshot(prev => ({ ...(prev.identity === identity ? prev : {}), identity, error }))
      }
    }
    load()
    const timer = window.setInterval(load, 60000)
    window.addEventListener('mvf-training-updated', load)
    window.addEventListener('focus', load)
    window.addEventListener('online', load)
    document.addEventListener('visibilitychange', load)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('mvf-training-updated', load)
      window.removeEventListener('focus', load)
      window.removeEventListener('online', load)
      document.removeEventListener('visibilitychange', load)
    }
  }, [identity, profile?.club_id, limit, attempt])
  return { ...(snapshot.identity === identity ? snapshot : {}), identity, retry }
}

function Notice({ notice }) {
  const { profile, teamKeys } = useAuth()
  const session = notice.training_sessions
  const canAnswer = session && notice.kind === 'moved' && !session.cancelled
    && profile?.active && profile.approved && profile.is_player
    && (session.audience === 'club' || teamKeys?.includes(session.audience))
    && !hasKickedOff(session.start_date, session.start_time)
  return <article className="card training-notice">
    <strong>{notice.title}</strong>
    <p>{notice.body}</p>
    {canAnswer && <Link className="btn btn-ghost" to={'/training?session=' + encodeURIComponent(session.id)}>Update your availability</Link>}
  </article>
}

const storageKey = id => 'mvf-training-last-notice/' + id
function lastSeen(id) {
  try { return localStorage.getItem(storageKey(id)) } catch { return null }
}
function markSeen(id, value) {
  try { localStorage.setItem(storageKey(id), value) } catch { /* Storage can be disabled. */ }
}

export function TrainingNoticeBanner() {
  const { rows, identity } = useNotices(1)
  const [dismissed, setDismissed] = useState(null)
  const latest = rows?.[0]
  if (!identity || !latest || lastSeen(identity) === latest.id || dismissed === latest.id) return null
  return <aside className="page training-notice-banner" aria-label="Training notification">
    <Notice notice={latest} />
    <div className="row spread">
      <Link className="btn btn-ghost" to="/training">Training notices</Link>
      <button className="btn btn-ghost" onClick={() => { markSeen(identity, latest.id); setDismissed(latest.id) }}>Dismiss</button>
    </div>
  </aside>
}

export default function TrainingNoticeInbox() {
  const [limit, setLimit] = useState(PAGE)
  const { rows, more, identity, error, retry } = useNotices(limit)
  const latest = rows?.[0]?.id
  useEffect(() => { if (identity && latest) markSeen(identity, latest) }, [identity, latest])
  if (!latest && !error) return null
  return <section aria-label="Training notices" className="col gap-2 mt-3">
    <h2 className="label">Training notices</h2>
    {error && <p role="alert">Training notices unavailable. <button className="btn btn-ghost" onClick={retry}>Try again</button></p>}
    {rows?.map(row => <Notice key={row.id} notice={row} />)}
    {more && <button className="btn btn-ghost" onClick={() => setLimit(n => n + PAGE)}>Earlier notices</button>}
  </section>
}
