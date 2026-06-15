import OpponentsPanel from '../components/OpponentsPanel'

export default function Opponents() {
  return (
    <div className="page">
      <p className="kicker"><span className="kicker-rule">OPPONENTS</span></p>
      <h1 className="display mt-2" style={{ fontSize: 28 }}>The teams you play</h1>
      <OpponentsPanel />
    </div>
  )
}
