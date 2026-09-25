import SeasonsPanel from '../components/SeasonsPanel'
import PageHead from '../components/PageHead'

export default function Seasons() {
  return (
    <div className="page">
      <PageHead kicker="SEASONS" title="Seasons" />
      <SeasonsPanel />
    </div>
  )
}
