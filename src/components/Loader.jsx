export default function Loader({ label = 'Warming up…' }) {
  return (
    <div className="loading-strip" role="status">
      <p>{label}</p>
      <div className="skeleton-lines" aria-hidden="true"><i /><i /><i /></div>
    </div>
  )
}
