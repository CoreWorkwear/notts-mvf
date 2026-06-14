import Crest from './Crest'

// Branded loader, not a generic spinner (DESIGN-SYSTEM §6.7).
export default function Loader({ label = 'Warming up…' }) {
  return (
    <div className="empty" style={{ paddingTop: 120 }}>
      <div style={{ display: 'inline-block', animation: 'pulse 1.2s var(--ease) infinite' }}>
        <Crest size={48} />
      </div>
      <p className="kicker mt-3">{label}</p>
      <style>{`@keyframes pulse{0%,100%{opacity:.45;transform:scale(.96)}50%{opacity:1;transform:scale(1)}}`}</style>
    </div>
  )
}
