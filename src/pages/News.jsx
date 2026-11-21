import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useNews } from '../hooks/useNews'
import NewsForm from '../components/NewsForm'
import Loader from '../components/Loader'
import Toast from '../components/Toast'
import { fmtDate } from '../lib/format'
import PageHead from '../components/PageHead'

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
  if (loading && firstLoad) return <Loader label="Loading news…" />

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
      <PageHead kicker="CLUB NEWS" title="What's on" />
      {error && <p className="dim mt-2" role="status" style={{ fontSize: 'var(--type-sm)' }}>Couldn't refresh. Showing saved posts.</p>}

      {isAdmin && (
        <button className="btn btn-primary btn-block mt-3" onClick={() => setComposing(true)}>+ Post news</button>
      )}

      {items.length === 0 ? (
        <div className="empty mt-5">
          <p className="empty-title">No club news</p>
        </div>
      ) : (
        <div className="col gap-3 mt-4">
          {items.map((n) => (
            <div key={n.id} className="card news-card">
              <div className="row spread">
                <span className="news-title">{n.title}</span>
                {n.pushed && <span className="member-tag">Sent to phones</span>}
              </div>
              <p className="news-body mt-2">{n.body}</p>
              <div className="row spread mt-2">
                <span className="news-meta">
                  <span className="mono">{fmtDate(n.created_at.slice(0, 10))}</span>{n.author ? ` · ${n.author.first_name} ${(n.author.last_name ?? '').slice(0, 1)}` : ''}
                </span>
                {isAdmin && <button className="news-del" onClick={() => onDelete(n.id)}>Delete</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {isAdmin && <NewsForm open={composing} onClose={() => setComposing(false)} onPost={post} />}

      <style>{`
        .news-card { padding: var(--space-4); background: var(--coal); border: 1px solid var(--line); }
        .news-title { font-family: var(--font-display); font-weight: 600; font-size: var(--type-lead); line-height: 1.1; }
        .news-body { color: var(--bone); font-size: var(--type-body); line-height: 1.5; white-space: pre-wrap; }
        .news-meta { font-size: var(--type-caption); color: var(--bone-mute); }
        .news-del { min-height: var(--target); padding-inline: var(--space-2); background: none; border: none; color: var(--red-bright); font-size: var(--type-sm); }
      `}</style>
    </div>
  )
}
