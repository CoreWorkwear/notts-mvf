import { ID, signInAsStubPlayer } from './stubSupabase.js'

// Representative, entirely fictitious rows for mobile layout captures. This
// build has no real backend. The route refuses to pass any API traffic through.
export const auditOrigin = 'https://matrix-local.supabase.co'
export const nextOpponent = 'Sherwood Athletic'
const dates = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

export function auditRows(role, { photoUrl, squad = 'xl', answered = false } = {}) {
  const teams = [
    { id: ID.team, club_id: ID.club, key: 'xl', label: 'XL 11s', match_name: 'Nottingham', is_first_team: true },
    { id: 'team-community', club_id: ID.club, key: 'community', label: 'Community', match_name: 'Notts Community' },
  ]
  const names = [['Sam', 'Marshall'], ['Alex', 'Wood'], ['Robin', 'Clarke'], ['Tom', 'Brooks'], ['Lee', 'Foster'], ['Jamie', 'Reed']]
  const myTeam = teams.find(team => team.key === squad)
  const profiles = names.map(([first_name, last_name], i) => ({
    id: i ? 'player-' + i : ID.player, first_name, last_name, club_id: ID.club, active: true,
    approved: i !== 0 || role !== 'pending', is_player: true, role: !i && role === 'manager' ? 'admin' : 'player',
    requested_teams: [], positions: ['CM'], preferred: 'CM', photo_url: null,
    team_memberships: i === 0 ? [{ team_id: myTeam.id, teams: myTeam }] : [{ team_id: ID.team, teams: teams[0] }],
  }))
  if (photoUrl && role === 'manager') profiles.push({
    id:'pending-player', first_name:'Casey', last_name:'Turner', club_id:ID.club,
    active:true, approved:false, is_player:true, role:'player', requested_teams:['community'],
    positions:['CB'], preferred:'CB', team_memberships:[],
  })
  const competition = { id: 'comp-one', name: 'County Sunday League', type: 'league', active: true, season_id: ID.season }
  const opponents = [nextOpponent, 'Trent Vale', 'Meadow Park', 'West Bridgford United'].map((name, i) => ({ id: 'opp-' + i, name }))
  const upcoming = '10000000-0000-4000-8000-000000000001'
  const avail = ['in', 'in', 'maybe', 'out'].map((status, i) => ({
    fixture_id: upcoming, profile_id: profiles[i + 1].id, status, profiles: profiles[i + 1], profile: profiles[i + 1],
  }))
  if (answered) avail.push({ fixture_id:upcoming, profile_id:ID.player, status:'in', profiles:profiles[0], profile:profiles[0] })
  const nextSunday = 7 - new Date().getUTCDay()
  const offsets = photoUrl ? [nextSunday, nextSunday+7, nextSunday-14, nextSunday-21] : [2,9,-6,-3]
  const fixtures = offsets.map((offset, i) => ({
    id: i === 0 ? upcoming : 'fixture-' + i, season_id: ID.season, team_id: teams[i % 2].id, team: teams[i % 2],
    match_date: dates(offset), kickoff: '10:30', fixture_type: 'League', home_away: i % 2 ? 'Away' : 'Home',
    venue: 'Forest Recreation Ground', address: 'Gregory Boulevard, Nottingham', postcode: 'NG7 6HB',
    status: 'scheduled', competition_id: competition.id, league_name: competition.name, opponent: opponents[i],
    opponent_id: opponents[i].id, availability: i === 0 ? avail : [], goals: [], results: [], result: null,
  }))
  const played = fixtures[2]
  // The upcoming poster has a pinned photo. The result uses the club pool.
  if (photoUrl) fixtures[0].pinned = { url: photoUrl }
  played.result = { us: 1, them: 0, ht_us: 0, ht_them: 0, motm_profile_id: profiles[1].id }
  played.results = [{ fixture_id: played.id }]
  played.goals = [{ id: 'goal-one', minute: 67, scorer_profile_id: profiles[1].id, assist_profile_id: profiles[2].id }]
  const lineups = profiles.slice(1, 4).map((p, i) => ({
    fixtures: played, fixture_id: played.id, profile_id: p.id, profiles: p, role: 'start', formation: '4-4-2',
    position: ['GK', 'RB', 'CB'][i], slot: i, player_name: p.first_name + ' ' + p.last_name,
  }))
  const tableRows = ['Nottingham', 'Sherwood Athletic', 'Trent Vale'].map((name, i) => ({
    id: 'table-' + i, season_id: ID.season, competition_id: competition.id, team_name: name, played: 4,
    won: 3 - i, drawn: 1, lost: i, gf: 9 - i, ga: 3, pts: 10 - 3 * i,
  }))
  const memberships = profiles.flatMap(p => p.team_memberships.map(m => ({ profile_id:p.id, profiles:p, ...m })))
  const tables = {
    clubs: [{ id: ID.club, name: 'Nottinghamshire MvF', crest_url: '/pwa-192x192.png' }],
    profiles, teams, fixtures, competitions: [competition], opponents, league_tables: tableRows, lineups,
    media_assets: photoUrl ? [{ id:'club-photo', type:'photo', url:photoUrl }] : [],
    team_memberships: memberships, availability: avail,
    announcements: [{ id: 'news-1', title: 'Training on Thursday', body: 'Meet at the pitch at seven.', created_at: dates(-1) + 'T12:00:00Z' }],
    sponsors: [{ id: 'sponsor-1', name: 'Radford Sports', active: true, tier: 'partner', sort_order: 1 }],
    reminder_settings: [{ club_id: ID.club, availability_enabled: true, match_enabled: true, availability_offsets: [72], match_offsets: [24] }],
  }
  return (table, params, defaults) => {
    let rows = tables[table] ?? defaults
    if (table === 'fixtures' && params.get('select')?.includes('results!inner')) rows = rows.filter(f => f.result)
    for (const [key, condition] of params) {
      if (condition.startsWith('eq.')) {
        const path = key.split('.')
        rows = rows.filter(row => String(path.reduce((part, name) => part?.[name], row)) === condition.slice(3))
      }
    }
    return rows
  }
}

export async function signInAsAuditMember(page, role = 'player', origin = auditOrigin, options = {}) {
  if (role === 'manager') await page.addInitScript(() => localStorage.setItem('mvf:managerView','1'))
  return signInAsStubPlayer(page, { origin, getRows: auditRows(role, options) })
}
