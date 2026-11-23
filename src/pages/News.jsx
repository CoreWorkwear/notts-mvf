import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useNews } from '../hooks/useNews'
import NewsForm from '../components/NewsForm'
import Loader from '../components/Loader'
import Toast from '../components/Toast'
import PageHead from '../components/PageHead'
import { IconBell } from '../components/Icons'
import '../styles/editorial.css'

const publishedDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London',
})

// Club news / notifications — everyone reads; admins post (and optionally push).
export default function News() {
  const { isAdmin } = useAuth()
  const { items, loading, loaded, error, post, remove, refetch } = useNews()
  const [composing, setComposing] = useState(false)
  const [toast, setToast] = useState(null)

  async function onDelete(id) {
    if (confirm('Delete this post?')) {
      try { await remove(id) } catch { setToast("Couldn't delete post. Try again.") }
    }
  }

  // Only the first load gets the Loader: a refetch after a post flips loading
  // too, and swapping the page out would unmount the open compose sheet. "First"
  // is the hook's `loaded`, not an empty list: the first-ever post refetches
  // with nothing listed yet.
  const firstLoad = !loaded && items.length === 0
  if (loading && firstLoad) return <Loader route="news" label="Loading news…" />

  // A failed first load is not an empty diary: say so and offer a retry.
  if (error && firstLoad) return (
    <div className="page">
      <div className="empty mt-5" role="alert">
        <p className="empty-title">Couldn't fetch the news</p>
        <button className="btn btn-primary mt-3" onClick={refetch}>Try again</button>
      </div>
    </div>
  )

  return (
    <div className="page">
      <Toast message={toast} onDismiss={() => setToast(null)} />
      <PageHead title="Club news" aside={isAdmin &&
        <button className="btn btn-ghost news-post" onClick={() => setComposing(true)}>Post news</button>} />
      {error && <p className="dim mt-2" role="status" style={{ fontSize: 'var(--type-sm)' }}>Couldn't refresh. Showing saved posts.</p>}

      {items.length === 0 ? (
        <div className="empty mt-5">
          <p className="empty-title">No club news</p>
        </div>
      ) : (
        <div className="news-feed">
          {items.map((n) => (
            <article key={n.id} className="news-story" id={`news-${n.id}`} aria-labelledby={`headline-${n.id}`}>
              <header>
                <div className="story-byline">
                  <time dateTime={n.created_at}>{publishedDate.format(new Date(n.created_at))}</time>
                  {n.author?.first_name && <span>By {n.author.first_name} {(n.author.last_name ?? '').slice(0, 1)}</span>}
                </div>
                <h2 id={`headline-${n.id}`}>{n.title}</h2>
              </header>
              <div className="story-copy">{(n.body ?? '').split(/(?:\r?\n[ \t]*){2,}/).filter(Boolean).map((paragraph, i) =>
                <p key={i}>{paragraph}</p>
              )}</div>
              {(n.pushed || isAdmin) && <footer>
                {n.pushed && <span className="story-delivery">
                  <IconBell aria-hidden="true" />Sent to phones
                </span>}
                {isAdmin && <button className="news-del" aria-label={`Delete ${n.title}`} onClick={() => onDelete(n.id)}>Delete</button>}
              </footer>}
            </article>
          ))}
        </div>
      )}

      {isAdmin && <NewsForm open={composing} onClose={() => setComposing(false)} onPost={post} />}
    </div>
  )
}
