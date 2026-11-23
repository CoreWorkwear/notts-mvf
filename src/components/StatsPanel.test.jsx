import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import StatsPanel from './StatsPanel'
import { buildStats } from '../lib/stats'

const stats = buildStats({
  names: { a: 'Sam Green', b: 'Robin Stone' },
  playedFixtures: [
    { team: { key: 'xl' }, fixture_type: 'League', goals: [{ scorer_profile_id: 'a', assist_profile_id: 'b' }] },
    { team: { key: 'community' }, fixture_type: 'Friendly', goals: [{ scorer_profile_id: 'b' }] },
  ],
  appearances: [{ profile_id: 'a', teamKey: 'xl', isLeague: true }],
})

test('switches squad scope from the keyboard and keeps tied leaders and league splits readable', async () => {
  const user = userEvent.setup()
  render(<StatsPanel stats={stats} />)
  const award = screen.getByRole('region', { name: 'Golden Boot' })
  expect(award).toHaveTextContent('Robin Stone')
  expect(award).toHaveTextContent('Sam Green')
  screen.getByRole('tab', { name: 'Whole Club' }).focus()
  await user.keyboard('{ArrowRight}')
  expect(screen.getByRole('tab', { name: '1st Team' })).toHaveFocus()
  expect(award).toHaveTextContent('Sam Green')
  expect(award).not.toHaveTextContent('Robin Stone')

  const squad = screen.getByRole('list', { name: 'Squad statistics' })
  await user.selectOptions(screen.getByLabelText('Sort squad by'), 'assists')
  const first = within(squad).getAllByRole('listitem')[0]
  expect(within(first).getByRole('heading')).toHaveTextContent('Robin Stone')
  expect(within(first).getByText('1 league, 0 friendly')).toBeInTheDocument()
  await user.click(screen.getByRole('tab', { name: 'Community' }))
  expect(within(squad).getAllByRole('listitem')).toHaveLength(1)
  expect(within(squad).getByText('0 league, 1 friendly')).toBeInTheDocument()
})
