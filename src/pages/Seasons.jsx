import SeasonsPanel from '../components/SeasonsPanel'

export default function Seasons() {
  return (
    <div className="page">
      <p className="kicker"><span className="kicker-rule">SEASONS</span></p>
      <h1 className="display mt-2" style={{ fontSize: 28 }}>Seasons</h1>
      <SeasonsPanel />
    </div>
  )
}
