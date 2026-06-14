// One consistent icon set, single stroke weight (DESIGN-SYSTEM §7) — mixed
// default icons read templated. Lucide-derived paths normalised to 1.75 stroke.
const base = {
  width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round',
}

export const IconFixtures = (p) => (
  <svg {...base} {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
)
export const IconResults = (p) => (
  <svg {...base} {...p}><path d="M6 9H4a2 2 0 0 1-2-2V4h4M18 9h2a2 2 0 0 0 2-2V4h-4M6 4h12v5a6 6 0 0 1-12 0V4ZM12 15v3M9 21h6M10 18h4" /></svg>
)
export const IconClub = (p) => (
  <svg {...base} {...p}><path d="M12 2 4 5v6c0 5 3.5 8 8 11 4.5-3 8-6 8-11V5l-8-3Z" /></svg>
)
export const IconWhosIn = (p) => (
  <svg {...base} {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
)
export const IconPlayers = (p) => (
  <svg {...base} {...p}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>
)
export const IconYou = (p) => (
  <svg {...base} {...p}><path d="M19 21v-2a5 5 0 0 0-5-5H10a5 5 0 0 0-5 5v2" /><circle cx="12" cy="7" r="4" /></svg>
)
export const IconChevron = (p) => (
  <svg {...base} {...p} width={p.width ?? 16} height={p.height ?? 16}><path d="m6 9 6 6 6-6" /></svg>
)
export const IconLogout = (p) => (
  <svg {...base} {...p} width={p.width ?? 18} height={p.height ?? 18}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
)
