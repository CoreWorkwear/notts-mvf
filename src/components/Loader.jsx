import PageHead from './PageHead'

const SCREENS = {
  training: ['Training', 'list'],
  fixtures: ['Fixtures', 'fixture'], results: ['Results', 'score'], club: ['The Club', 'table'],
  you: ['You', 'profile'], news: ['Club news', 'article'], manage: ['Club admin', 'list'],
  'whos-in': ["Who's in", 'list'], players: ['Players', 'list'], opponents: ['Opponents', 'list'],
  seasons: ['Seasons', 'list'], media: ['Club media', 'gallery'], reminders: ['Auto reminders', 'form'],
  sponsors: ['Club sponsors', 'list'], diagnostics: ['App errors', 'form'], competitions: ['Competitions', 'list'],
}

export default function Loader({ label = 'Loading…', route, title, layout = 'list' }) {
  const screen = route && (SCREENS[route.replace(/^\/|\/$/g, '')] ?? SCREENS.fixtures)
  const shape = screen?.[1] ?? layout
  return (
    <div className={screen ? 'page route-loader' : 'loading-strip'} role="status" aria-label={label}>
      {screen && <PageHead title={title ?? screen[0]}
        aside={shape === 'fixture' && <span className="loading-view-switch" aria-hidden="true" />} />}
      <span className="sr-only">{label}</span>
      <div className="loading-skeleton" data-skeleton={shape} aria-hidden="true">
        <i /><i /><i />
      </div>
    </div>
  )
}
