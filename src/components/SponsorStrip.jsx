import ClubImage from './ClubImage'
import { useSponsors, byTier, sponsorWebsite } from '../hooks/useSponsors'

function Logo({ s, size }) {
  const img = <ClubImage src={s.logo_url} alt={s.name} width={size * 3} height={size} style={{ width: size * 3 }} />
  const href = sponsorWebsite(s.website)
  return href
    ? <a className="sp-logo" href={href} target="_blank" rel="noreferrer">{img}</a>
    : <span className="sp-logo">{img}</span>
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
          <span className="sp-label">Team sponsor</span>
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
        .sponsors-strip { margin-top: var(--space-6); padding: var(--space-4) var(--space-4) calc(var(--space-4) + var(--nav-height, 0px) + var(--nav-gap) + var(--safe-b));
          border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: var(--space-3); align-items: center; text-align: center; }
        .sp-block { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); }
        .sp-label { font-family: var(--font-body); font-size: var(--type-xs); letter-spacing: .1em; text-transform: uppercase; color: var(--bone-mute); }
        .sp-label-sm { font-size: var(--type-xs); opacity: .9; }
        .sp-logos { display: flex; flex-wrap: wrap; gap: var(--space-2); justify-content: center; align-items: center; }
        .sp-logo { display: inline-flex; align-items: center; justify-content: center; background: var(--bone);
          border-radius: var(--r-card); padding: var(--space-2) var(--space-3); }
        .sp-kit .sp-logo { padding: var(--space-1) var(--space-2); border-radius: var(--r-input); opacity: .92; }
        .sp-logo img { display: block; width: auto; object-fit: contain; }
      `}</style>
    </div>
  )
}
