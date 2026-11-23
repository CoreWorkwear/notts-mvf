import { Children } from 'react'

// A short run of fixtures or leaderboards can be flicked with the thumb.
// Long diaries keep their vertical reading order. Keyboard users can step
// between cards without having to tab through every control in each one.
export default function SnapRail({ children, label, className = '', enabled = true }) {
  const items = Children.toArray(children)
  if (!enabled || items.length < 2) return <div className={className}>{items}</div>

  function step(event) {
    if (event.target !== event.currentTarget || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const rail = event.currentTarget
    const cards = [...rail.children]
    const left = rail.getBoundingClientRect().left
    const offsets = cards.map(card => card.getBoundingClientRect().left - left)
    const delta = event.key === 'Home' ? -rail.scrollWidth
      : event.key === 'End' ? rail.scrollWidth
      : event.key === 'ArrowRight' ? offsets.find(x => x > 2) : offsets.reverse().find(x => x < -2)
    if (delta != null) rail.scrollBy({ left: delta, behavior: 'instant' })
  }

  return <div className={className + ' snap-rail'} role="region" aria-label={label} tabIndex={0} onKeyDown={step}>
    {items}
  </div>
}
