import Crest from './Crest'

// Broadcast-bug scoreline (DESIGN-SYSTEM §6.3): crests flanking a big mono
// score on a dark grained card — a mini TV score bug. Our crest left, opponent
// right; score is us–them. Animates in on mount.
export default function ScoreBug({ fixture, size = 'lg' }) {
  const f = fixture
  const r = f.result
  const them = f.opponent
  const big = size === 'lg'

  return (
    <div className={'bug' + (big ? ' lg' : '')}>
      <div className="bug-side">
        <Crest size={big ? 40 : 30} />
        <span className="bug-team mono">{f.team?.label}</span>
      </div>

      <div className="bug-score mono">
        <span className="num" key={'u' + r.us}>{r.us}</span>
        <span className="dash">–</span>
        <span className="num" key={'t' + r.them}>{r.them}</span>
      </div>

      <div className="bug-side">
        {them?.badge_url
          ? <img src={them.badge_url} alt="" width={big ? 40 : 30} height={big ? 40 : 30} style={{ borderRadius: 8 }} />
          : <span className="bug-monogram" style={{ width: big ? 40 : 30, height: big ? 40 : 30 }}>{(them?.name || '?')[0]}</span>}
        <span className="bug-team mono">{them?.name}</span>
      </div>

      <style>{`
        .bug { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 10px; }
        .bug-side { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; }
        .bug-team { font-size: 11px; color: var(--bone-mute); text-align: center; max-width: 100%;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; letter-spacing: .02em; }
        .bug-score { display: flex; align-items: center; gap: 10px; }
        .bug .num { font-weight: 600; animation: scorein var(--t-med) backwards; }
        .bug .dash { color: var(--bone-dim); }
        .bug.lg .num { font-size: 54px; }
        .bug.lg .dash { font-size: 38px; }
        .bug:not(.lg) .num { font-size: 30px; }
        .bug-monogram { border-radius: 8px; display: grid; place-items: center; font-weight: 700;
          border: 1.5px dashed var(--line-2); color: var(--bone-mute); }
        @keyframes scorein { from { opacity: 0; transform: translateY(6px) scale(.9) } to { opacity: 1; transform: none } }
      `}</style>
    </div>
  )
}
