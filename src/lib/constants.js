// Shared constants. Positions are a frontend constant, not a table (HANDOVER §3).

export const POSITIONS = [
  'GK', 'RB', 'CB', 'LB', 'CDM', 'CM', 'CAM', 'RM', 'LM', 'RW', 'LW', 'ST', 'CF',
]

// Team keys + identity. First Team (key 'xl', red) listed first everywhere.
// NB: the key stays 'xl' (all code/RLS keys off it); only the label is "First Team".
export const TEAMS = {
  xl:        { key: 'xl',        label: 'First Team', colour: '#E11D2A', isFirstTeam: true },
  community: { key: 'community', label: 'Community',  colour: '#2FA84F', isFirstTeam: false },
}
export const TEAM_ORDER = ['xl', 'community']

// Brand hexes (mirror tokens.css for use in inline styles / canvas later).
export const COLOURS = {
  red: '#E11D2A', redBright: '#FF3340',
  green: '#2FA84F', greenBright: '#44D268',
  gold: '#E8B53F', amber: '#F5A623',
  bone: '#F2F0EC', boneMute: '#9aa39c',
}

// £7 per player per game. Banked now; surfaced when subs/payments land.
export const MATCH_FEE = 7

// Shortest password we'll let anyone set. Length is the only strength rule
// worth imposing (NCSC/OWASP: length beats composition rules, which just push
// people towards Passw0rd!). Six was Supabase's default and far too short for
// an account holding squad-mates' phone numbers and emergency contacts.
//
// This is a UX check, NOT a control — a self-signup can call GoTrue directly
// and skip every line of this file. The control is Supabase Dashboard →
// Authentication → Policies: set "Minimum password length" to 10 and turn ON
// leaked-password protection (HaveIBeenPwned). Keep the two in step.
//
// Existing shorter passwords keep working: sign-in never re-checks length,
// so nobody is locked out — only newly set passwords have to clear the bar.
export const MIN_PASSWORD = 10

export const FIXTURE_TYPES = ['League', 'Friendly', 'Cup', 'Other']
export const AVAIL = { IN: 'in', MAYBE: 'maybe', OUT: 'out' }

// British-football labels for availability (GLOSSARY.md — never Americanised).
export const AVAIL_LABEL = { in: "I'm in", maybe: 'Maybe', out: "Can't make it" }
