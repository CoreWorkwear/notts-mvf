import { useSyncExternalStore } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { readDiary } from '../lib/fixtureDiary'
import { fmtDate, fmtKO } from '../lib/format'

function subscribe(update) {
  window.addEventListener('online', update)
  window.addEventListener('offline', update)
  return () => {
    window.removeEventListener('online', update)
    window.removeEventListener('offline', update)
  }
}

function storedUserId() {
  try { return JSON.parse(localStorage.getItem(supabase.auth.storageKey))?.user?.id }
  catch { return null }
}

export default function OfflineDiary() {
  const { user, reconnecting } = useAuth()
  const offline = useSyncExternalStore(subscribe, () => navigator.onLine === false)
  if (!offline) return null
  const diary = readDiary(user?.id || (reconnecting && storedUserId()))
  return (
    <section className="offline-diary" aria-label="Offline fixtures">
      <p role="status">You're offline. Changes need a connection.</p>
      {!diary && <p>Open Fixtures online to save the diary on this phone.</p>}
      {diary && <details open>
        <summary>Last saved fixtures{diary.season && ' · ' + diary.season}</summary>
        <p className="muted">Saved {new Date(diary.savedAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/London' })} UK time</p>
        {diary.games.length ? <ul>{diary.games.map(f => <li key={f.id}>
          <strong>{f.title}</strong><br />
          {fmtDate(f.date)} · {f.postponed ? 'Postponed' : fmtKO(f.kickoff)}{f.venue && ' · ' + f.venue}
        </li>)}</ul> : <p>No upcoming fixtures in this saved diary.</p>}
      </details>}
    </section>
  )
}
