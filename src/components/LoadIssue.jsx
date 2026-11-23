export default function LoadIssue({ subject, retry, stale = false }) {
  return <div className="mt-3" role={stale ? 'status' : 'alert'}>
    <p>{stale ? "Couldn't refresh " + subject + ". Showing the last saved list." : "Couldn't load " + subject + "."}</p>
    <button type="button" className="btn btn-ghost mt-2" onClick={retry}>Try again</button>
  </div>
}
