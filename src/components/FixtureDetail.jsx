import { useEffect, useState } from 'react'
import Sheet from './Sheet'
import AvailControl from './AvailControl'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { fmtDateLong, fmtKO } from '../lib/format'

// Fixture detail: poster header, My availability, venue + directions, Who's in.
// (Full who's-in team-sheet + no-reply chase land at step 6; this is the
// fuller-picture sheet the strips/calendar open into.)
export default function FixtureDetail({ open, onClose, fixture, isAdmin, onSetAvail, onEdit }) {
  const { user } = useAuth()
  const [tab, setTab] = useState('me')
  const [rows, setRows] = useState([])

  useEffect(() => {
    if (!open || !fixture) return
    setTab('me')
    supabase
      .from('availability')
      .select('status, profile:profiles(id, first_name, last_name)')
      .eq('fixture_id', fixture.id)
      .then(({ data }) => setRows(data ?? []))
  }, [open, fixture])

  if (!fixture) return null
  const f = fixture
  const isXL = f.team?.key === 'xl'
  const grad = isXL ? 'var(--grad-xl)' : 'var(--grad-community)'
  const mapsQuery = encodeURIComponent(f.address || f.venue)
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`
  const w3wUrl = f.w3w ? `https://what3words.com/${f.w3w.replace(/^\/+/, '')}` : null

  const group = (s) => rows.filter((r) => r.status === s)
  const name = (r) => `${r.profile?.first_name ?? '?'} ${(r.profile?.last_name ?? '').slice(0, 1)}`
  const isMe = (r) => r.profile?.id === user?.id

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="det-hero" style={{ backgroundImage: `var(--hero-wash), ${grad}` }}>
        <span className="kicker" style={{ color: 'rgba(255,255,255,.85)' }}>{f.team?.label} · {f.home_away} · {f.fixture_type}</span>
        <h2 className="display" style={{ fontSize: 32, color: '#fff', marginTop: 6 }}>{f.opponent?.name}</h2>
        <p className="mono" style={{ color: 'rgba(255,255,255,.9)', fontSize: 13, marginTop: 4 }}>
          {fmtDateLong(f.match_date)} · {fmtKO(f.kickoff)} KO
        </p>
        {isAdmin && <button className="btn btn-ghost det-edit" onClick={onEdit}>Edit fixture</button>}
      </div>

      <div className="row gap-2 mt-4">
        <button className={'btn grow ' + (tab === 'me' ? 'btn-primary' : 'btn-ghost')} onClick={() => setTab('me')}>My availability</button>
        <button className={'btn grow ' + (tab === 'who' ? 'btn-primary' : 'btn-ghost')} onClick={() => setTab('who')}>Who's in</button>
      </div>

      {tab === 'me' ? (
        <div className="mt-4">
          <AvailControl value={f.myStatus} onChange={onSetAvail} />

          <p className="kicker mt-5"><span className="kicker-rule">VENUE</span></p>
          <p className="mt-2" style={{ fontWeight: 600 }}>{f.venue}</p>
          {f.address && <p className="muted" style={{ fontSize: 14 }}>{f.address}</p>}
          <div className="row gap-2 mt-3">
            <a className="btn btn-ghost grow" href={mapsUrl} target="_blank" rel="noreferrer">Open in Maps</a>
            {w3wUrl && <a className="btn btn-ghost grow" href={w3wUrl} target="_blank" rel="noreferrer">{f.w3w}</a>}
          </div>
        </div>
      ) : (
        <div className="mt-4 col gap-4">
          <WhoGroup title="Available" colour="var(--green-bright)" rows={group('in')} name={name} isMe={isMe} />
          <WhoGroup title="Maybe" colour="var(--amber)" rows={group('maybe')} name={name} isMe={isMe} />
          <WhoGroup title="Can't make it" colour="var(--red-bright)" rows={group('out')} name={name} isMe={isMe} />
          <p className="muted center" style={{ fontSize: 14 }}>{f.noReply} not replied yet</p>
        </div>
      )}

      <style>{`
        .det-hero { border-radius: var(--r-hero); padding: 16px; position: relative; }
        .det-edit { position: absolute; top: 14px; right: 14px; padding: 5px 12px; font-size: 13px;
          background: rgba(0,0,0,.25); color: #fff; border-color: rgba(255,255,255,.25); }
      `}</style>
    </Sheet>
  )
}

function WhoGroup({ title, colour, rows, name, isMe }) {
  return (
    <div>
      <p className="kicker" style={{ color: colour }}>{title} · {rows.length}</p>
      {rows.length === 0 ? (
        <p className="dim mt-2" style={{ fontSize: 14 }}>—</p>
      ) : (
        <div className="row gap-2 mt-2" style={{ flexWrap: 'wrap' }}>
          {rows.map((r, i) => (
            <span key={i} className="chip" style={isMe(r) ? { borderColor: colour, color: colour } : {}}>
              {name(r)}{isMe(r) ? ' · YOU' : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
