import { Link } from 'react-router-dom'
import { IconWhosIn, IconPlayers, IconOpponents, IconSeasons, IconMedia, IconReminders, IconSponsors } from '../components/Icons'

// Admin hub — keeps the bottom nav uncluttered by gathering the management /
// config screens in one place (rather than as extra tabs + buried toggles).
const TOOLS = [
  { to: '/whos-in',   label: "Who's In",  blurb: 'Availability across games + chase the no-shows', Icon: IconWhosIn },
  { to: '/players',   label: 'Players',   blurb: 'Squad records, roles, first-team eligibility, subs', Icon: IconPlayers },
  { to: '/opponents', label: 'Opponents', blurb: 'The teams you play + their badges',              Icon: IconOpponents },
  { to: '/seasons',   label: 'Seasons',   blurb: 'Create a season, set current, roll over',        Icon: IconSeasons },
  { to: '/media',     label: 'Media',     blurb: 'Club crest + photo pool for posters',            Icon: IconMedia },
  { to: '/reminders', label: 'Reminders', blurb: 'Auto-nudge the squad before kickoff',            Icon: IconReminders },
  { to: '/sponsors',  label: 'Sponsors',  blurb: 'Main, kit + MOTM sponsor logos',                 Icon: IconSponsors },
]

export default function Manage() {
  return (
    <div className="page">
      <p className="kicker"><span className="kicker-rule">MANAGE</span></p>
      <h1 className="display mt-2" style={{ fontSize: 28 }}>Club admin</h1>

      <div className="manage-grid mt-4">
        {TOOLS.map(({ to, label, blurb, Icon }) => (
          <Link key={to} to={to} className="card manage-card">
            <Icon width={24} height={24} />
            <span className="mc-title">{label}</span>
            <span className="mc-blurb">{blurb}</span>
          </Link>
        ))}
      </div>

      <style>{`
        .manage-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .manage-card { display: flex; flex-direction: column; gap: 6px; padding: 16px;
          background: var(--coal); border: 1px solid var(--line); color: var(--bone); }
        .manage-card svg { color: var(--red); }
        .mc-title { font-family: var(--font-display); font-weight: 600; font-size: 17px; line-height: 1; margin-top: 2px; }
        .mc-blurb { font-size: 12px; color: var(--bone-mute); line-height: 1.35; }
        @media (max-width: 380px) { .manage-grid { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  )
}
