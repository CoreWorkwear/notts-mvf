import OpponentsPanel from '../components/OpponentsPanel'
import PageHead from '../components/PageHead'

export default function Opponents() {
  return (
    <div className="page">
      <PageHead kicker="OPPONENTS" title="The teams you play" />
      <OpponentsPanel />
    </div>
  )
}
