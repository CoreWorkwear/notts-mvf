import { useState } from 'react'

// Sub-toggle between League Table and Club Stats (HANDOVER §5). Real grids and
// the golden-boot stats engine land at build order step 8.
export default function Club() {
  const [view, setView] = useState('table')
  return (
    <div className="page">
      <p className="kicker"><span className="kicker-rule">THE CLUB</span></p>
      <div className="row gap-2 mt-3">
        <button className={'btn grow ' + (view === 'table' ? 'btn-primary' : 'btn-ghost')} onClick={() => setView('table')}>League Table</button>
        <button className={'btn grow ' + (view === 'stats' ? 'btn-primary' : 'btn-ghost')} onClick={() => setView('stats')}>Club Stats</button>
      </div>

      {view === 'table' ? (
        <div className="empty mt-5">
          <p className="empty-title">Table's empty</p>
          <p>The manager keeps this current from the league's own source. Nothing in it yet.</p>
        </div>
      ) : (
        <div className="empty mt-5">
          <p className="empty-title">No stats to argue over</p>
          <p>Golden boot, top scorers, the lot — it all fills in once results start landing.</p>
        </div>
      )}
    </div>
  )
}
