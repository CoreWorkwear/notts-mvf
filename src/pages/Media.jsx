import MediaPanel from '../components/MediaPanel'

export default function Media() {
  return (
    <div className="page">
      <p className="kicker"><span className="kicker-rule">MEDIA</span></p>
      <h1 className="display mt-2" style={{ fontSize: 28 }}>Club media</h1>
      <MediaPanel />
    </div>
  )
}
