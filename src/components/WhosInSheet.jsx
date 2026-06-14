import { useEffect, useState } from 'react'
import Sheet from './Sheet'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { fmtDateLong, fmtKO } from '../lib/format'

// The Who's In team-sheet (DESIGN-SYSTEM §6.2 / UX-AND-IA §3): not an RSVP
// list — the XI filling up, a big count, and a one-tap chase for the lads who
// haven't replied. Chase = a plain WhatsApp-ready message to copy (push lands
// at the notifications step; AI drafting is post-MVP).
export default function WhosInSheet({ open, onClose, fixture }) {
  const { user } = useAuth()
  const [groups, setGroups] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open || !fixture) return
    setGroups(null); setCopied(false)
    ;(async () => {
      const [availRes, rosterRes] = await Promise.all([
        supabase
          .from('availability')
          .select('status, profile:profiles(id, first_name, last_name, phone)')
          .eq('fixture_id', fixture.id),
        supabase
          .from('team_memberships')
          .select('profiles!inner(id, first_name, last_name, phone, active, xl_eligible)')
          .eq('team_id', fixture.team_id),
      ])

      const replied = {}
      const buckets = { in: [], maybe: [], out: [] }
      for (const a of availRes.data ?? []) {
        const p = a.profile
        if (!p) continue
        replied[p.id] = true
        if (a.status in buckets) buckets[a.status].push(person(p, user))
      }

      const isXL = fixture.team?.key === 'xl'
      const noReply = []
      for (const m of rosterRes.data ?? []) {
        const p = m.profiles
        if (!p?.active) continue
        if (isXL && !p.xl_eligible) continue
        if (!replied[p.id]) noReply.push(person(p, user))
      }

      setGroups({ ...buckets, noReply })
    })()
  }, [open, fixture, user])

  if (!fixture) return null
  const f = fixture
  const isCommunity = f.team?.key === 'community'

  async function chase() {
    const names = groups.noReply.map((p) => p.first).join(', ')
    const us = f.team?.label
    const them = f.opponent?.name
    const matchup = f.home_away === 'Home' ? `${us} v ${them}` : `${them} v ${us}`
    const msg =
      `Oi lads 👊 ${matchup} — ${fmtDateLong(f.match_date)}, ${fmtKO(f.kickoff)} KO at ${f.venue}.\n` +
      `Still waiting on: ${names}.\nYou in? Give us a shout.`
    try {
      await navigator.clipboard.writeText(msg)
      setCopied(true)
      setTimeout(() => setCopied(false), 2200)
    } catch {
      alert(msg) // clipboard blocked — show it to copy by hand
    }
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <p className="kicker"><span className={'kicker-rule' + (isCommunity ? ' community' : '')}>WHO'S IN</span></p>
      <h2 className="display mt-2" style={{ fontSize: 24 }}>
        {f.home_away === 'Home' ? `${f.team?.label} v ${f.opponent?.name}` : `${f.opponent?.name} v ${f.team?.label}`}
      </h2>
      <p className="mono muted" style={{ fontSize: 13 }}>{fmtDateLong(f.match_date)} · {fmtKO(f.kickoff)} KO</p>

      {!groups ? (
        <p className="muted mt-5 center">Counting heads…</p>
      ) : (
        <>
          <div className="ti-count">
            <span className="display ti-num" key={groups.in.length}>{groups.in.length}</span>
            <span className="kicker">IN{isCommunity ? '' : ''}</span>
          </div>

          <TeamSheet people={groups.in} accent={isCommunity ? 'var(--green)' : 'var(--red)'} />

          <Group title="Maybe" colour="var(--amber)" people={groups.maybe} />
          <Group title="Can't make it" colour="var(--red-bright)" people={groups.out} />
          <Group title="Not replied" colour="var(--bone-mute)" people={groups.noReply} />

          {groups.noReply.length > 0 && (
            <button className="btn btn-primary btn-block mt-5" onClick={chase}>
              {copied ? 'Copied — paste in WhatsApp ✓' : `Chase the ${groups.noReply.length} who've gone quiet`}
            </button>
          )}
        </>
      )}

      <style>{`
        .ti-count { display: flex; align-items: baseline; gap: 10px; margin: 18px 0 6px; }
        .ti-num { font-size: 64px; line-height: 1; animation: pop var(--t-med) backwards; }
        @keyframes pop { from { opacity: 0; transform: scale(.7) } to { opacity: 1; transform: scale(1) } }
        .ti-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
        .ti-slot { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 56px;
          animation: fadeup var(--t-med) backwards; }
        .ti-av { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center;
          font-family: var(--font-mono); font-weight: 600; font-size: 15px; color: var(--bone);
          background: var(--slate); border: 1.5px solid var(--av-accent); }
        .ti-name { font-size: 11px; color: var(--bone-mute); text-align: center; line-height: 1.1;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 56px; }
        .ti-empty { color: var(--bone-dim); font-size: 14px; margin-top: 8px; }
        .grp { margin-top: 18px; }
        .grp-people { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
      `}</style>
    </Sheet>
  )
}

function person(p, user) {
  return {
    id: p.id,
    first: p.first_name,
    name: `${p.first_name} ${(p.last_name ?? '').slice(0, 1)}`,
    initials: `${(p.first_name ?? '?')[0] ?? ''}${(p.last_name ?? '')[0] ?? ''}`.toUpperCase(),
    phone: p.phone,
    isMe: p.id === user?.id,
  }
}

function TeamSheet({ people, accent }) {
  if (people.length === 0) return <p className="ti-empty">No one's in yet — be the first.</p>
  return (
    <div className="ti-grid">
      {people.map((p, i) => (
        <div key={p.id} className="ti-slot" style={{ animationDelay: `${i * 35}ms` }}>
          <span className="ti-av" style={{ '--av-accent': accent }}>{p.initials}</span>
          <span className="ti-name">{p.isMe ? 'You' : p.first}</span>
        </div>
      ))}
    </div>
  )
}

function Group({ title, colour, people }) {
  return (
    <div className="grp">
      <p className="kicker" style={{ color: colour }}>{title} · {people.length}</p>
      {people.length === 0 ? (
        <p className="dim" style={{ fontSize: 14, marginTop: 6 }}>—</p>
      ) : (
        <div className="grp-people">
          {people.map((p) => (
            <span key={p.id} className="chip" style={p.isMe ? { borderColor: colour, color: colour } : {}}>
              {p.isMe ? 'You' : p.name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
