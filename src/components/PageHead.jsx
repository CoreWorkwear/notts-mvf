export default function PageHead({ title, aside }) {
  return (
    <div className="page-head">
      <h1 className="page-title display">{title}</h1>
      {aside && <div className="ph-aside">{aside}</div>}
    </div>
  )
}
