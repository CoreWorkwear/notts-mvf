// Who's In (admin) — the signature lean-forward team-sheet across upcoming
// games, with chase-the-non-repliers (UX-AND-IA §3). Built at step 6.
export default function AdminAvailability() {
  return (
    <div className="page">
      <p className="kicker"><span className="kicker-rule">WHO'S IN</span></p>
      <h1 className="display mt-2" style={{ fontSize: 30 }}>Who's about</h1>
      <div className="empty mt-5">
        <p className="empty-title">No games to chase</p>
        <p>Set a fixture and you'll see who's in, who's maybe, and who's gone quiet.</p>
      </div>
    </div>
  )
}
