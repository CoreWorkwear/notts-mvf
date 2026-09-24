import { Component } from 'react'
import { logError, BUILD } from '../lib/logger'

// Last-ditch catch so a render error shows a club-voice fallback, not a white
// screen. (Per-feature errors are still handled inline where they happen.)
// The build stamp is shown small so a screenshot from a player tells us which
// deploy (or stale cached bundle) crashed.
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) { return { error } }

  componentDidCatch(error, info) {
    console.error('App error:', error, info)
    logError('render', error ?? 'render error', { componentStack: String(info?.componentStack ?? '').slice(0, 1500) })
  }

  render() {
    if (this.state.error) {
      return (
        <div className="empty" style={{ paddingTop: 120 }}>
          <p className="empty-title">That's gone a bit wrong</p>
          <p>Give it a refresh — should sort itself.</p>
          <button className="btn btn-primary mt-4" onClick={() => location.reload()}>Refresh</button>
          <p className="mono dim mt-4" style={{ fontSize: 11 }}>build {BUILD}</p>
        </div>
      )
    }
    return this.props.children
  }
}
