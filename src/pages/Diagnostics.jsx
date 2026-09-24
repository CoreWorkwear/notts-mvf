import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { fmtDateLong } from '../lib/format'
import { logError, BUILD, _queuedRows } from '../lib/logger'
import { getBreadcrumbs } from '../lib/breadcrumbs'
import { friendlyError } from '../lib/errors'
import { groupErrors, kindsOf, fmtAgo, fmtCrumb, shortUA } from '../lib/diagnostics'
import { pushSupported, currentSubscription } from '../lib/push'
import Loader from '../components/Loader'
import Toast from '../components/Toast'

// Admin observability: the most recent errors logged from players' devices, so
// breakage is visible without waiting for someone to complain (RLS: admin read).
// Rows are grouped into one card per distinct problem (kind + message) with a
// count; tap a card for the occurrences, each with the build it came from, the
// route, and the breadcrumb trail of what the player was doing beforehand.
export default function Diagnostics() {
  const { user } = useAuth()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [kind, setKind] = useState('all')
  const [open, setOpen] = useState(null)
  const [device, setDevice] = useState(null)
  const [toast, setToast] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const { data, error: fetchErr } = await supabase
        .from('client_errors')
        .select('id, created_at, kind, message, url, context, user_agent')
        .order('created_at', { ascending: false })
        .limit(200)
      // A failed load is NOT "all quiet" — that would hide exactly the outage
      // this screen exists to show.
      if (fetchErr) throw fetchErr
      setRows(data ?? [])
    } catch (e) {
      logError('fetch', e ?? 'diagnostics load failed', { hook: 'Diagnostics' })
      setError(e ?? new Error('load failed'))
    }
  }, [])

  useEffect(() => { load() }, [load])

  // What THIS device looks like — the same facts every logged row carries,
  // plus the live push/service-worker state, so the manager can sanity-check
  // their own phone before chasing a player's.
  useEffect(() => {
    let on = true
    ;(async () => {
      const info = {
        build: BUILD,
        online: typeof navigator !== 'undefined' ? navigator.onLine : null,
        ua: typeof navigator !== 'undefined' ? shortUA(navigator.userAgent) : '—',
        installed: !!(window.matchMedia?.('(display-mode: standalone)')?.matches || navigator.standalone === true),
        sw: navigator.serviceWorker?.controller ? 'active' : 'none',
        notifications: typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
        push: 'unsupported',
        queued: _queuedRows().length,
        userId: user?.id ?? null,
      }
      if (pushSupported) {
        try {
          const sub = await Promise.race([currentSubscription(), new Promise((r) => setTimeout(() => r('timeout'), 1500))])
          info.push = sub === 'timeout' ? 'unknown (no service worker yet)' : sub ? 'subscribed' : 'not subscribed'
        } catch { info.push = 'unknown' }
      }
      if (on) setDevice(info)
    })()
    return () => { on = false }
  }, [user?.id])

  async function clearAll() {
    if (!confirm('Clear all logged errors?')) return
    setBusy(true)
    try {
      const { error: delErr } = await supabase.from('client_errors').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      if (delErr) throw delErr
      await load()
    } catch (e) {
      setToast(friendlyError(e, "Couldn't clear the log."))
    } finally {
      setBusy(false)
    }
  }

  // End-to-end check of the logging pipeline from this device: the row should
  // appear at the top of the list a moment later.
  async function ping() {
    setBusy(true)
    await logError('test', `Diagnostics test ping ${new Date().toISOString()}`, { op: 'ping' })
    setTimeout(async () => { await load(); setBusy(false) }, 800)
  }

  if (error && !rows) return (
    <div className="page">
      <div className="empty mt-5">
        <p className="empty-title">Couldn't load the log</p>
        <p>{friendlyError(error)}</p>
        <button className="btn btn-primary mt-3" onClick={load}>Try again</button>
      </div>
    </div>
  )
  if (!rows) return <Loader label="Loading the logs…" />

  const kinds = kindsOf(rows)
  const visible = kind === 'all' ? rows : rows.filter((r) => r.kind === kind)
  const groups = groupErrors(visible)

  return (
    <div className="page">
      <Toast message={toast} onDismiss={() => setToast(null)} />
      <div className="row spread" style={{ alignItems: 'flex-end' }}>
        <div>
          <p className="kicker"><span className="kicker-rule">DIAGNOSTICS</span></p>
          <h1 className="display mt-2" style={{ fontSize: 28 }}>App errors</h1>
        </div>
        <div className="row gap-2">
          <button className="chip" disabled={busy} onClick={ping} title="Log a test error from this device">Test</button>
          {rows.length > 0 && <button className="chip" disabled={busy} onClick={clearAll}>Clear</button>}
        </div>
      </div>

      {error && <p className="dim mt-2" role="status" style={{ fontSize: 13 }}>Refresh failed — showing the last good list. {friendlyError(error)}</p>}

      {device && (
        <div className="card err-row mt-4" data-testid="device-panel">
          <p className="kicker"><span className="kicker-rule">THIS DEVICE</span></p>
          <div className="mono err-kv mt-2">
            <span>build</span><span>{device.build}</span>
            <span>online</span><span>{String(device.online)}</span>
            <span>device</span><span>{device.ua}{device.installed ? ' · installed' : ' · browser tab'}</span>
            <span>service worker</span><span>{device.sw}</span>
            <span>notifications</span><span>{device.notifications}</span>
            <span>push</span><span>{device.push}</span>
            {device.queued > 0 && <><span>unsent errors</span><span>{device.queued} queued (offline)</span></>}
          </div>
          <details className="mt-2">
            <summary className="dim" style={{ fontSize: 13, cursor: 'pointer' }}>Breadcrumbs this session</summary>
            <pre className="mono err-pre">{getBreadcrumbs().map(fmtCrumb).join('\n') || '—'}</pre>
          </details>
        </div>
      )}

      {kinds.length > 1 && (
        <div className="row gap-2 mt-4" style={{ flexWrap: 'wrap' }} role="group" aria-label="Filter by kind">
          <button className="chip" aria-pressed={kind === 'all'} onClick={() => setKind('all')}>All · {rows.length}</button>
          {kinds.map((k) => (
            <button key={k} className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {k} · {rows.filter((r) => r.kind === k).length}
            </button>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="empty mt-5">
          <p className="empty-title">All quiet 🟢</p>
          <p>No errors logged from anyone's device. Crashes, failed loads and blocked saves would show here.</p>
        </div>
      ) : (
        <div className="col gap-2 mt-4">
          {groups.map((g) => {
            const isOpen = open === g.key
            return (
              <div key={g.key} className="card err-row">
                <button className="err-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : g.key)}>
                  <div className="row spread">
                    <span className={'err-kind k-' + g.kind}>{g.kind}</span>
                    <span className="mono err-when">{g.count > 1 ? `×${g.count} · ` : ''}{fmtAgo(g.last)}</span>
                  </div>
                  <div className="err-msg">{g.message}</div>
                  {g.urls.length > 0 && <div className="mono err-url">{g.urls.slice(0, 3).join(' · ')}{g.urls.length > 3 ? ' …' : ''}</div>}
                  {g.builds.length > 0 && <div className="mono err-url">build {g.builds.join(', ')}</div>}
                </button>
                {isOpen && (
                  <div className="col gap-2 mt-2">
                    {g.rows.slice(0, 10).map((r) => <Occurrence key={r.id} row={r} />)}
                    {g.rows.length > 10 && <p className="dim mono" style={{ fontSize: 11 }}>… and {g.rows.length - 10} more</p>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <style>{`
        .err-row { padding: 12px 14px; background: var(--coal); border: 1px solid var(--line); }
        .err-head { display: block; width: 100%; text-align: left; background: none; border: 0; padding: 0; color: inherit; font: inherit; cursor: pointer; }
        .err-kind { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: .05em;
          text-transform: uppercase; padding: 2px 8px; border-radius: 6px; background: var(--slate); color: var(--bone-mute); }
        .err-kind.k-render, .err-kind.k-rejection, .err-kind.k-error { color: var(--red-bright); border: 1px solid var(--red); }
        .err-kind.k-write, .err-kind.k-fetch, .err-kind.k-timeout, .err-kind.k-auth, .err-kind.k-push { color: var(--amber); border: 1px solid var(--amber); }
        .err-kind.k-test { color: var(--green-bright); border: 1px solid var(--green); }
        .err-when { font-size: 11px; color: var(--bone-dim); }
        .err-msg { margin-top: 8px; font-size: 14px; line-height: 1.35; word-break: break-word; }
        .err-url { font-size: 11px; color: var(--bone-mute); margin-top: 6px; word-break: break-all; }
        .err-occ { border-top: 1px solid var(--line); padding-top: 8px; }
        .err-pre { font-size: 10.5px; line-height: 1.4; white-space: pre-wrap; word-break: break-word; margin: 6px 0 0;
          padding: 8px; background: var(--slate); border-radius: 8px; color: var(--bone-mute); max-height: 260px; overflow: auto; }
        .err-kv { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; font-size: 12px; }
        .err-kv > span:nth-child(odd) { color: var(--bone-dim); }
      `}</style>
    </div>
  )
}

const HIDDEN_KEYS = new Set(['breadcrumbs', 'stack', 'componentStack'])

function Occurrence({ row: r }) {
  const ctx = r.context && typeof r.context === 'object' ? r.context : null
  const rest = ctx ? Object.fromEntries(Object.entries(ctx).filter(([k]) => !HIDDEN_KEYS.has(k))) : null
  const when = `${fmtDateLong(r.created_at.slice(0, 10))} · ${new Date(r.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
  return (
    <div className="err-occ">
      <div className="mono err-when">{when} · {r.url ?? '—'} · {shortUA(r.user_agent)}{ctx?.build ? ` · ${ctx.build}` : ''}</div>
      {Array.isArray(ctx?.breadcrumbs) && ctx.breadcrumbs.length > 0 && (
        <pre className="mono err-pre" data-testid="breadcrumbs">{ctx.breadcrumbs.map(fmtCrumb).join('\n')}</pre>
      )}
      {rest && Object.keys(rest).length > 0 && <pre className="mono err-pre">{JSON.stringify(rest, null, 1)}</pre>}
      {ctx?.stack && <pre className="mono err-pre">{String(ctx.stack).split('\n').slice(0, 8).join('\n')}</pre>}
      {ctx?.componentStack && <pre className="mono err-pre">{String(ctx.componentStack).split('\n').slice(0, 6).join('\n')}</pre>}
    </div>
  )
}
