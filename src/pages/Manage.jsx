import { Link } from 'react-router-dom'
import PageHead from '../components/PageHead'
import { Stagger, StaggerItem } from '../components/Stagger'
import { IconWhosIn, IconPlayers, IconOpponents, IconSeasons, IconMedia, IconReminders, IconSponsors, IconDiagnostics, IconCompetitions } from '../components/Icons'

// Admin hub — keeps the bottom nav uncluttered by gathering the management /
// config screens in one place (rather than as extra tabs + buried toggles).
//
// Label and icon only. Every card used to carry a line of explanation, which
// across nine cards was a wall of grey text the manager read once and then had
// to look past every time. The destinations are named things in the club's own
// vocabulary — they don't need a caption.
const TOOLS = [
  { to: '/whos-in',      label: "Who's In",     Icon: IconWhosIn },
  { to: '/players',      label: 'Players',      Icon: IconPlayers },
  { to: '/opponents',    label: 'Opponents',    Icon: IconOpponents },
  { to: '/competitions', label: 'Competitions', Icon: IconCompetitions },
  { to: '/seasons',      label: 'Seasons',      Icon: IconSeasons },
  { to: '/media',        label: 'Media',        Icon: IconMedia },
  { to: '/reminders',    label: 'Reminders',    Icon: IconReminders },
  { to: '/sponsors',     label: 'Sponsors',     Icon: IconSponsors },
  { to: '/diagnostics',  label: 'Diagnostics',  Icon: IconDiagnostics },
]

export default function Manage() {
  return (
    <div className="page">
      <PageHead kicker="MANAGE" title="Club admin" />

      <Stagger className="manage-grid mt-4">
        {TOOLS.map(({ to, label, Icon }) => (
          <StaggerItem key={to}>
            <Link to={to} className="card manage-card">
              <Icon width={22} height={22} />
              <span className="mc-title">{label}</span>
            </Link>
          </StaggerItem>
        ))}
      </Stagger>

      <style>{`
        .manage-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .manage-card {
          display: flex; align-items: center; gap: 11px;
          padding: 16px 15px; height: 100%;
          background: var(--coal); border: 1px solid var(--line); color: var(--bone);
          text-decoration: none;
          transition: border-color var(--t-fast), transform var(--t-fast);
        }
        .manage-card svg { color: var(--red); flex: none; }
        .mc-title { font-family: var(--font-display); font-weight: 600; font-size: 16px; line-height: 1.05; }
        @media (hover: hover) and (pointer: fine) {
          .manage-card:hover { border-color: var(--line-2); transform: translateY(-2px); }
        }
        .manage-card:active { transform: scale(.985); }
        @media (max-width: 340px) { .manage-grid { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  )
}
