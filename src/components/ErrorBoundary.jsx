import { Component } from 'react'

// Last-ditch catch so a render error shows a club-voice fallback, not a white
// screen. (Per-feature errors are still handled inline where they happen.)
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) { return { error } }

  componentDidCatch(error, info) { console.error('App error:', error, info) }

  render() {
    if (this.state.error) {
      return (
        <div className="empty" style={{ paddingTop: 120 }}>
          <p className="empty-title">That's gone a bit wrong</p>
          <p>Give it a refresh — should sort itself.</p>
          <button className="btn btn-primary mt-4" onClick={() => location.reload()}>Refresh</button>
        </div>
      )
    }
    return this.props.children
  }
}
