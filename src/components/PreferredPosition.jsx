import { POSITIONS } from '../lib/constants'

export default function PreferredPosition({ value, onChange, options = POSITIONS }) {
  return <div className="field" role="group" aria-label="Preferred position">
    <span className="label">Preferred position</span>
    <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
      {options.map(position => <button type="button" key={position} className="chip"
        aria-label={'Prefer ' + position} aria-pressed={position === value}
        onClick={() => onChange(position === value ? '' : position)}>{position}</button>)}
    </div>
  </div>
}
