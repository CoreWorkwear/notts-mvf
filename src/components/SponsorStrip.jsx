import { useSponsors, byTier, sponsorWebsite } from '../hooks/useSponsors'

function Logo({ s, size }) {
  const img = <img src={s.logo_url} alt={s.name} style={{ height: size }} />
  const href = sponsorWebsite(s.website)
  return href
    ? <a className="sp-logo" href={href} target="_blank" rel="noreferrer" title={s.name}>{img}</a>
    : <span className="sp-logo" title={s.name}>{img}</span>
}

// Sponsor logo banner carried across the app (rendered app-wide, below the page).
// Main/team sponsor leads; kit sponsor sits smaller and quieter beneath.
export default function SponsorStrip() {
  const { sponsors } = useSponsors()
  const main = byTier(sponsors, 'main')
  const kit = byTier(sponsors, 'kit')
  if (main.length === 0 && kit.length === 0) return null

  return (
    <div className="sponsors-strip">
      {main.length > 0 && (
        <div className="sp-block">
          <span className="sp-label">Proudly sponsored by</span>
          <div className="sp-logos">{main.map((s) => <Logo key={s.id} s={s} size={40} />)}</div>
        </div>
      )}
      {kit.length > 0 && (
        <div className="sp-block sp-kit">
          <span className="sp-label sp-label-sm">Kit sponsor</span>
          <div className="sp-logos">{kit.map((s) => <Logo key={s.id} s={s} size={26} />)}</div>
        </div>
      )}

      <style>{`
        .sponsors-strip { margin-top: 28px; padding: 18px 16px calc(18px + var(--safe-b, 0px));
          border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 14px; align-items: center; text-align: center; }
        .sp-block { display: flex; flex-direction: column; align-items: center; gap: 8px; }
        .sp-label { font-family: var(--font-mono); font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--bone-dim); }
        .sp-label-sm { font-size: 9px; opacity: .85; }
        .sp-logos { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; align-items: center; }
        .sp-logo { display: inline-flex; align-items: center; justify-content: center; background: var(--bone);
          border-radius: 10px; padding: 8px 12px; }
        .sp-kit .sp-logo { padding: 6px 10px; border-radius: 8px; opacity: .92; }
        .sp-logo img { display: block; width: auto; object-fit: contain; }
      `}</style>
    </div>
  )
}
