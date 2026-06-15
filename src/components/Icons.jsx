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
export const IconManage = (p) => (
  <svg {...base} {...p}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
)
export const IconOpponents = (p) => (
  <svg {...base} {...p}><path d="M4 22V3M4 3h13l-2.5 4L17 11H4" /></svg>
)
export const IconSeasons = (p) => (
  <svg {...base} {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M8 2v4M16 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" /></svg>
)
export const IconMedia = (p) => (
  <svg {...base} {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-4.5-4.5L5 21" /></svg>
)
export const IconBell = (p) => (
  <svg {...base} {...p} width={p.width ?? 18} height={p.height ?? 18}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
)
export const IconSponsors = (p) => (
  <svg {...base} {...p}><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L3 13V3h10l7.59 7.59a2 2 0 0 1 0 2.82Z" /><circle cx="7.5" cy="7.5" r="1.5" /></svg>
)
export const IconReminders = (p) => (
  <svg {...base} {...p}><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5M5 3 2 6M22 6l-3-3" /></svg>
)
export const IconChevron = (p) => (
  <svg {...base} {...p} width={p.width ?? 16} height={p.height ?? 16}><path d="m6 9 6 6 6-6" /></svg>
)
export const IconLogout = (p) => (
  <svg {...base} {...p} width={p.width ?? 18} height={p.height ?? 18}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
)
export const IconSun = (p) => (
  <svg {...base} {...p} width={p.width ?? 18} height={p.height ?? 18}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></svg>
)
export const IconMoon = (p) => (
  <svg {...base} {...p} width={p.width ?? 18} height={p.height ?? 18}><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>
)
