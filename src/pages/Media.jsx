import MediaPanel from '../components/MediaPanel'
import PageHead from '../components/PageHead'

export default function Media() {
  return (
    <div className="page">
      <PageHead kicker="MEDIA" title="Club media" />
      <MediaPanel />
    </div>
  )
}
