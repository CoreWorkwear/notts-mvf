import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useNews } from '../hooks/useNews'
import NewsForm from '../components/NewsForm'
import { Stagger, StaggerItem } from '../components/Stagger'
import Loader from '../components/Loader'
import Toast from '../components/Toast'
import { fmtDate } from '../lib/format'

// Club news / notifications — everyone reads; admins post (and optionally push).
export default function News() {
  const { isAdmin } = useAuth()
  const { items, loading, post, remove } = useNews()
  const [composing, setComposing] = useState(false)
  const [toast, setToast] = useState(null)

  if (loading) return <Loader label="Catching up on the news…" />

  async function onDelete(id) {
    if (confirm('Delete this post?')) {
      try { await remove(id) } catch { setToast("Couldn't delete that post — give it another go.") }
    }
  }

  return (
    <div className="page">
      <Toast message={toast} onDismiss={() => setToast(null)} />
      <p className="kicker"><span className="kicker-rule">CLUB NEWS</span></p>
      <h1 className="display mt-2" style={{ fontSize: 28 }}>What's on</h1>

      {isAdmin && (
        <button className="btn btn-primary btn-block mt-3" onClick={() => setComposing(true)}>+ Post news</button>
      )}

      {items.length === 0 ? (
        <div className="empty mt-5">
          <p className="empty-title">Nothing in the diary yet</p>
          <p>{isAdmin ? 'Post the first update — tick push and it pings everyone.' : "Club updates will land here. We'll ping you when there's news."}</p>
        </div>
      ) : (
        <Stagger className="col gap-3 mt-4">
          {items.map((n) => (
            <StaggerItem key={n.id} className="card news-card">
              <div className="row spread">
                <span className="news-title">{n.title}</span>
                {n.pushed && <span className="tag" title="Pushed to phones">🔔</span>}
              </div>
              <p className="news-body mt-2">{n.body}</p>
              <div className="row spread mt-2">
                <span className="mono news-meta">
                  {fmtDate(n.created_at.slice(0, 10))}{n.author ? ` · ${n.author.first_name} ${(n.author.last_name ?? '').slice(0, 1)}` : ''}
                </span>
                {isAdmin && <button className="news-del" onClick={() => onDelete(n.id)}>Delete</button>}
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      )}

      {isAdmin && <NewsForm open={composing} onClose={() => setComposing(false)} onPost={post} />}

      <style>{`
        .news-card { padding: 16px; background: var(--coal); border: 1px solid var(--line); }
        .news-title { font-family: var(--font-display); font-weight: 600; font-size: 18px; line-height: 1.1; }
        .news-body { color: var(--bone); font-size: 15px; line-height: 1.5; white-space: pre-wrap; }
        .news-meta { font-size: 12px; color: var(--bone-mute); }
        .news-del { background: none; border: none; color: var(--red-bright); font-size: 13px; }
      `}</style>
    </div>
  )
}
