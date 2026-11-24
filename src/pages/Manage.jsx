import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePaymentsRelease } from '../hooks/usePaymentsRelease'
import { IconChevron, IconWhosIn, IconPlayers, IconOpponents, IconSeasons, IconMedia, IconReminders, IconSponsors, IconDiagnostics, IconCompetitions, IconBell } from '../components/Icons'

const groups = [
  ['Matchday', [["Who's In", '/whos-in', IconWhosIn], ['Players', '/players', IconPlayers], ['Reminders', '/reminders', IconReminders]]],
  ['Competitions and fixtures', [['Competitions', '/competitions', IconCompetitions], ['Opponents', '/opponents', IconOpponents], ['Seasons', '/seasons', IconSeasons]]],
  ['Around the club', [['News', '/news', IconBell], ['Media', '/media', IconMedia], ['Sponsors', '/sponsors', IconSponsors]]],
  ['App support', [['Diagnostics', '/diagnostics', IconDiagnostics]]],
]

export default function Manage() {
  const { user, profile } = useAuth()
  const release = usePaymentsRelease(user?.id, profile?.club_id)
  const sections = release.enabled
    ? [...groups, ['Club settings', [['Fees', '/manage/fees', IconCompetitions], ['Opening balances', '/manage/settings/opening-balances', IconPlayers], ['Stripe', '/manage/settings/stripe', IconDiagnostics], ['Activity charges', '/manage/accounts-report', IconDiagnostics]]]]
    : groups
  return <div className="page">
    <h1 className="display page-title">Club admin</h1>
    {sections.map(([heading, links]) => <section key={heading} className="manage-section">
      <h2>{heading}</h2>
      <div className="manage-links">
        {links.map(([label, to, Icon]) => <Link key={to} to={to} className="manage-link">
          <Icon width={20} height={20} aria-hidden="true" />{label}<IconChevron className="go" aria-hidden="true" />
        </Link>)}
      </div>
    </section>)}
  </div>
}
