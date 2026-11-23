import { expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import OpponentsPanel from './OpponentsPanel'
import SponsorsList from './SponsorsList'
import SquadList from './SquadList'
import SeasonsPanel from './SeasonsPanel'

const failed = vi.hoisted(() => ({ error: new Error('Connection lost'), loading: false, refetch: vi.fn() }))
vi.mock('../hooks/useOpponents', () => ({ useOpponents: () => ({ opponents: [], ...failed }) }))
vi.mock('../hooks/useSponsors', () => ({ useSponsors: () => ({ sponsors: [], ...failed }) }))
vi.mock('../hooks/useSquad', () => ({ useSquad: () => ({ players: [], ...failed }) }))
vi.mock('../context/SeasonContext', () => ({ useSeason: () => ({ seasons: [], ...failed, refreshSeasons: failed.refetch }) }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ profile: {} }) }))

test.each([OpponentsPanel, SponsorsList, SquadList, SeasonsPanel].map(Panel => [Panel.name, Panel]))('%s shows a retry for a failed first load', (_, Panel) => {
  render(<Panel />)
  expect(screen.getByRole('alert')).toHaveTextContent(/couldn't load/i)
  screen.getByRole('button', { name: 'Try again' }).click()
  expect(failed.refetch).toHaveBeenCalled()
  failed.refetch.mockClear()
})
