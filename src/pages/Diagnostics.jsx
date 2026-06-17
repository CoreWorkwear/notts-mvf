import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtDateLong } from '../lib/format'
import Loader from '../components/Loader'

// Admin observability: the most recent errors logged from players' devices, so
// breakage is visible without waiting for someone to complain (RLS: admin read).
export default function Diagnostics() {
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = () => supabase
    .from('client_errors')
    .select('id, created_at, kind, message, url, context')
    .order('created_at', { ascending: false })
    .limit(100)
    .then(({ data }) => setRows(data ?? []))

  useEffect(() => { load() }, [])

  async function clearAll() {
    if (!confirm('Clear all logged errors?')) return
    setBusy(true)
    await supabase.from('client_errors').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await load()
    setBusy(false)
  }

  if (!rows) return <Loader label="Loading the logs…" />

  return (
    <div className="page">
      <div className="row spread" style={{ alignItems: 'flex-end' }}>
        <div>
          <p className="kicker"><span className="kicker-rule">DIAGNOSTICS</span></p>
          <h1 className="display mt-2" style={{ fontSize: 28 }}>App errors</h1>
        </div>
        {rows.length > 0 && <button className="chip" disabled={busy} onClick={clearAll}>Clear</button>}
      </div>

      {rows.length === 0 ? (
        <div className="empty mt-5">
          <p className="empty-title">All quiet 🟢</p>
          <p>No errors logged from anyone's device. Crashes, failed loads and blocked saves would show here.</p>
        </div>
      ) : (
        <div className="col gap-2 mt-4">
          {rows.map((r) => (
            <div key={r.id} className="card err-row">
              <div className="row spread">
                <span className={'err-kind k-' + r.kind}>{r.kind}</span>
                <span className="mono err-when">{fmtDateLong(r.created_at)} · {new Date(r.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <div className="err-msg">{r.message}</div>
              {r.url && <div className="mono err-url">{r.url}</div>}
            </div>
          ))}
        </div>
      )}

      <style>{`
        .err-row { padding: 12px 14px; background: var(--coal); border: 1px solid var(--line); }
        .err-kind { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: .05em;
          text-transform: uppercase; padding: 2px 8px; border-radius: 6px; background: var(--slate); color: var(--bone-mute); }
        .err-kind.k-render, .err-kind.k-rejection, .err-kind.k-error { color: var(--red-bright); border: 1px solid var(--red); }
        .err-kind.k-write, .err-kind.k-fetch { color: var(--amber); border: 1px solid var(--amber); }
        .err-when { font-size: 11px; color: var(--bone-dim); }
        .err-msg { margin-top: 8px; font-size: 14px; line-height: 1.35; word-break: break-word; }
        .err-url { font-size: 11px; color: var(--bone-mute); margin-top: 6px; }
      `}</style>
    </div>
  )
}
