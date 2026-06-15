import { useEffect, useState } from 'react'
import Sheet from './Sheet'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { fmtDateLong, fmtKO } from '../lib/format'
import { MATCH_FEE } from '../lib/constants'
import { buildFixtureCsv, csvFilename, downloadCsv } from '../lib/csv'
import { isSquadMember } from '../lib/players'

// The Who's In team-sheet (DESIGN-SYSTEM §6.2 / UX-AND-IA §3): not an RSVP
// list — the XI filling up, a big count, and a one-tap chase for the players who
// haven't replied. For admins it also carries the weekly subs jobs (§10): a
// paid/not-paid toggle per available player, and a per-fixture CSV export.
export default function WhosInSheet({ open, onClose, fixture }) {
  const { user, isAdmin } = useAuth()
  const [groups, setGroups] = useState(null)
  const [copied, setCopied] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [pushMsg, setPushMsg] = useState(null)

  useEffect(() => {
    if (!open || !fixture) return
    setGroups(null); setCopied(false)
    ;(async () => {
      const [availRes, rosterRes, payRes] = await Promise.all([
        supabase
          .from('availability')
          .select('status, profile:profiles(id, first_name, last_name, phone, preferred)')
          .eq('fixture_id', fixture.id),
        supabase
          .from('team_memberships')
          .select('profiles!inner(id, first_name, last_name, phone, active, approved, is_player, xl_eligible)')
          .eq('team_id', fixture.team_id),
        supabase.from('payments').select('profile_id, paid').eq('fixture_id', fixture.id),
      ])

      const paidById = Object.fromEntries((payRes.data ?? []).map((p) => [p.profile_id, p.paid]))
      const replied = {}
      const buckets = { in: [], maybe: [], out: [] }
      for (const a of availRes.data ?? []) {
        const p = a.profile
        if (!p) continue
        replied[p.id] = true
        if (a.status in buckets) {
          const per = person(p, user)
          if (a.status === 'in') per.paid = !!paidById[p.id]
          buckets[a.status].push(per)
        }
      }

      const isXL = fixture.team?.key === 'xl'
      const noReply = []
      for (const m of rosterRes.data ?? []) {
        const p = m.profiles
        if (!isSquadMember(p)) continue          // skip supporters + pending players
        if (isXL && !p.xl_eligible) continue
        if (!replied[p.id]) noReply.push(person(p, user))
      }

      setGroups({ ...buckets, noReply })
    })()
  }, [open, fixture, user])

  if (!fixture) return null
  const f = fixture
  const isCommunity = f.team?.key === 'community'

  async function togglePaid(id, next) {
    setGroups((g) => ({ ...g, in: g.in.map((p) => (p.id === id ? { ...p, paid: next } : p)) }))
    const { error } = await supabase
      .from('payments')
      .upsert({ fixture_id: f.id, profile_id: id, paid: next }, { onConflict: 'fixture_id,profile_id' })
    if (error) {
      setGroups((g) => ({ ...g, in: g.in.map((p) => (p.id === id ? { ...p, paid: !next } : p)) }))
      alert(error.message)
    }
  }

  function exportCsv() {
    const players = groups.in.map((p) => ({ name: p.name, preferred: p.preferred, paid: !!p.paid }))
    downloadCsv(csvFilename(f), buildFixtureCsv(f, players))
  }

  // Push nudge to the fixture's eligible roster (needs the send-push Edge
  // Function deployed; fails gracefully otherwise).
  async function pushReminder() {
    setPushing(true); setPushMsg(null)
    try {
      const { data, error } = await supabase.functions.invoke('send-push', {
        body: {
          fixtureId: f.id, withAvailability: true,
          title: `${f.team?.label} v ${f.opponent?.name}`,
          body: `${fmtDateLong(f.match_date)}, ${fmtKO(f.kickoff)} KO — you in?`,
        },
      })
      if (error) throw error
      setPushMsg(`Pushed to ${data?.sent ?? 0}`)
    } catch {
      setPushMsg('Push unavailable (deploy send-push?)')
    } finally {
      setPushing(false)
      setTimeout(() => setPushMsg(null), 2800)
    }
  }

  async function chase() {
    const names = groups.noReply.map((p) => p.first).join(', ')
    const us = f.team?.label
    const them = f.opponent?.name
    const matchup = f.home_away === 'Home' ? `${us} v ${them}` : `${them} v ${us}`
    const msg =
      `Players 👊 ${matchup} — ${fmtDateLong(f.match_date)}, ${fmtKO(f.kickoff)} KO at ${f.venue}.\n` +
      `Still waiting on: ${names}.\nYou in? Give us a shout.`
    try {
      await navigator.clipboard.writeText(msg)
      setCopied(true)
      setTimeout(() => setCopied(false), 2200)
    } catch {
      alert(msg)
    }
  }

  const paidCount = groups?.in.filter((p) => p.paid).length ?? 0

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
            <span className="kicker">IN</span>
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
          {isAdmin && groups.in.length + groups.noReply.length > 0 && (
            <button className="btn btn-ghost btn-block mt-2" disabled={pushing} onClick={pushReminder}>
              {pushing ? 'Sending…' : pushMsg || 'Send push reminder'}
            </button>
          )}

          {/* Subs — admin only (HANDOVER §10) */}
          {isAdmin && groups.in.length > 0 && (
            <div className="subs mt-5">
              <div className="row spread" style={{ alignItems: 'center' }}>
                <p className="kicker"><span className="kicker-rule">SUBS · £{MATCH_FEE}</span></p>
                <button className="chip" onClick={exportCsv}>Export CSV</button>
              </div>
              <div className="col gap-2 mt-3">
                {groups.in.map((p) => (
                  <div key={p.id} className="sub-row">
                    <span className="grow">{p.isMe ? 'You' : p.name}{p.preferred ? <span className="dim"> · {p.preferred}</span> : null}</span>
                    <button className={'chip' + (p.paid ? ' paid-on' : '')} aria-pressed={!!p.paid} onClick={() => togglePaid(p.id, !p.paid)}>
                      {p.paid ? 'Paid ✓' : 'Not paid'}
                    </button>
                  </div>
                ))}
              </div>
              <p className="dim mt-2" style={{ fontSize: 12 }}>
                {paidCount} of {groups.in.length} paid · £{paidCount * MATCH_FEE} collected
              </p>
            </div>
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
        .sub-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); }
        .chip.paid-on { background: var(--green-dim-2); border-color: var(--green); color: var(--green-bright); }
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
    preferred: p.preferred ?? null,
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
