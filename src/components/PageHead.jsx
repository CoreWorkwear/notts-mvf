import { Sequence } from './Reveal'

// Every page opens the same way: a ruled mono kicker, a display heading, and
// optionally something on the right (a view switch, an action). Each page used
// to hand-roll this with a repeated `style={{ fontSize: 28 }}` — a token that
// lived nowhere and drifted per page. Now it is one component with one class,
// and the three parts arrive in sequence rather than as a single block.
//
// `aside` sits bottom-right of the heading and gets the last beat of the
// sequence, so the eye lands on the heading before the controls.
export default function PageHead({ kicker, title, aside, accent = 'red' }) {
  return (
    <div className="page-head">
      <div className="ph-text">
        <Sequence index={0}>
          <p className="kicker">
            <span className={'kicker-rule' + (accent === 'community' ? ' community' : '')}>{kicker}</span>
          </p>
        </Sequence>
        <Sequence index={1}>
          <h1 className="page-title display">{title}</h1>
        </Sequence>
      </div>
      {aside && <Sequence index={2} className="ph-aside">{aside}</Sequence>}
    </div>
  )
}
