import { useSponsors, sponsorWebsite } from '../hooks/useSponsors'

// Player-facing roll-call on the Club page: every sponsor with their logo +
// details, grouped by tier in order of prominence.
const GROUPS = [
  { tier: 'main',    label: 'Team Sponsor' },
  { tier: 'kit',     label: 'Kit Sponsor' },
  { tier: 'motm',    label: 'Man of the Match Sponsor' },
  { tier: 'partner', label: 'Club Partners' },
]

function Card({ s }) {
  const href = sponsorWebsite(s.website)
  const inner = (
    <>
      <span className="sl-logo">
        {s.logo_url ? <img src={s.logo_url} alt={s.name} /> : <span className="sl-logo-empty mono">{(s.name?.[0] ?? '?').toUpperCase()}</span>}
      </span>
      <span className="sl-main">
        <span className="sl-name">{s.name}</span>
        {s.website && <span className="sl-web">{s.website}</span>}
      </span>
      {href && <span className="sl-go">↗</span>}
    </>
  )
  return href
    ? <a className="card sl-row" href={href} target="_blank" rel="noreferrer">{inner}</a>
    : <div className="card sl-row">{inner}</div>
}

export default function SponsorsList() {
  const { sponsors, loading } = useSponsors()
  const active = (sponsors ?? []).filter((s) => s.active)

  return (
    <div className="mt-4">
      {!loading && active.length === 0 ? (
        <div className="empty mt-2">
          <p className="empty-title">No sponsors listed yet</p>
          <p>The club's sponsors and partners will appear here.</p>
        </div>
      ) : (
        GROUPS.map((g) => {
          const list = active.filter((s) => s.tier === g.tier)
          if (!list.length) return null
          return (
            <div key={g.tier} className="mt-5">
              <p className="kicker"><span className="kicker-rule">{g.label}</span></p>
              <div className="col gap-2 mt-3">
                {list.map((s) => <Card key={s.id} s={s} />)}
              </div>
            </div>
          )
        })
      )}

      <style>{`
        .sl-row { display: flex; align-items: center; gap: 14px; padding: 12px 14px; background: var(--coal);
          color: var(--bone); border: 1px solid var(--line); text-align: left; }
        .sl-logo { width: 64px; height: 48px; flex: none; border-radius: 10px; background: var(--bone);
          display: grid; place-items: center; overflow: hidden; }
        .sl-logo img { max-width: 100%; max-height: 100%; object-fit: contain; }
        .sl-logo-empty { background: var(--slate); width: 100%; height: 100%; display: grid; place-items: center;
          color: var(--bone-mute); font-weight: 700; }
        .sl-main { flex: 1; min-width: 0; }
        .sl-name { display: block; font-weight: 600; }
        .sl-web { display: block; font-size: 12px; color: var(--bone-mute); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sl-go { color: var(--bone-dim); font-size: 16px; }
      `}</style>
    </div>
  )
}
