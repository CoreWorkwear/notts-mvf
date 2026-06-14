import { useAuth } from '../context/AuthContext'

// Landing + primary action surface (UX-AND-IA §1). The next-game poster hero
// with one-tap availability lands at build order step 5. Cold-start state here.
export default function Fixtures() {
  const { profile, isAdmin } = useAuth()
  return (
    <div className="page">
      <p className="kicker"><span className="kicker-rule">{isAdmin ? 'THE GAFFER' : 'NEXT UP'}</span></p>
      <h1 className="display mt-2" style={{ fontSize: 30 }}>
        {isAdmin ? 'Run the day' : `Alright${profile?.first_name ? ', ' + profile.first_name : ''}`}
      </h1>

      <div className="empty mt-5">
        <p className="empty-title">Nothing in the diary yet</p>
        <p>Season's coming. {isAdmin ? "Add the first fixture and the lads can mark themselves in." : 'First fixture lands here when the gaffer sets it.'}</p>
      </div>
    </div>
  )
}
