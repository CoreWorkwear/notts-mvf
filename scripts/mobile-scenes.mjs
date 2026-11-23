import { nextOpponent } from '../e2e/mobileAuditData.js'

const textReady = (p, name) => p.getByText(name, { exact: true }).first().waitFor()
const tap = (p, role, name) => p.getByRole(role, { name, exact: typeof name === 'string' }).first().click()
const openDetail = p => tap(p, 'button', /match details/i)
export const mobileScreens = [
  ['player-hero', 'player', '/fixtures', p => textReady(p, nextOpponent)],
  ['manager-hero', 'manager', '/fixtures', async p => { await textReady(p, nextOpponent); await p.getByRole('button',{name:'Add a fixture'}).waitFor() }],
  ['calendar', 'player', '/fixtures', async p => { await textReady(p,nextOpponent); await tap(p,'tab','Calendar'); await p.getByRole('button',{name:'Next month'}).waitFor() }],
  ['add-fixture', 'manager', '/fixtures', async p => { await tap(p,'button','Add a fixture'); await p.getByRole('dialog').getByRole('button',{name:'Add fixture',exact:true}).waitFor() }],
  ['fixture-detail', 'player', '/fixtures', async p => { await openDetail(p); await p.getByRole('dialog').getByText(nextOpponent, {exact:true}).waitFor() }],
  ['whos-in', 'manager', '/whos-in', p => p.getByRole('button', {name:/Sherwood Athletic/}).waitFor()],
  ['squad-replies', 'manager', '/whos-in', async p => { await tap(p, 'button', /Sherwood Athletic/); await p.getByRole('dialog').getByText('Alex',{exact:true}).waitFor() }],
  ['line-up', 'manager', '/fixtures', async p => {
    await openDetail(p); await tap(p, 'tab', 'Line-up'); await tap(p, 'button', /Pick the line-up/i)
    await p.getByRole('button', { name: 'Save line-up' }).waitFor()
  }],
  ['results', 'manager', '/results', p => p.getByRole('button',{name:/match centre/i}).waitFor()],
  ['match-centre', 'player', '/results', async p => { await tap(p, 'button', /match centre/i); await p.getByRole('dialog').getByText('Alex Wood', {exact:true}).first().waitFor() }],
  ['log-result', 'manager', '/results', async p => { await tap(p, 'button', /West Bridgford United/); await p.getByRole('dialog').getByText('Full time', {exact:true}).waitFor() }],
  ['club-table', 'player', '/club', p => p.getByRole('cell',{name:'Sherwood Athletic'}).waitFor()],
  ['club-stats', 'player', '/club', async p => { await tap(p, 'tab', 'Stats'); await textReady(p, 'Alex Wood') }],
  ['club-squad', 'player', '/club', async p => { await tap(p,'tab','Squad'); await textReady(p,'Alex Wood') }],
  ['club-sponsors', 'player', '/club', async p => { await tap(p,'tab','Sponsors'); await textReady(p,'Radford Sports') }],
  ['you', 'player', '/you', p => textReady(p, '+447700900123')],
  ['edit-profile', 'player', '/you', async p => { await textReady(p,'+447700900123'); await tap(p,'button','Edit your details'); await p.getByRole('dialog').getByRole('button',{name:'Save changes'}).waitFor() }],
  ['manage', 'manager', '/manage', p => p.getByRole('link',{name:'Diagnostics'}).waitFor()],
  ['join', 'public', '/fixtures', async p => { await tap(p, 'tab', 'Join up'); await p.getByRole('button',{name:'Join the squad'}).waitFor() }],
  ['pending', 'pending', '/fixtures', p => textReady(p, 'Awaiting manager approval')],
  ['players', 'manager', '/players', p => textReady(p, 'Alex Wood')],
  ['competitions', 'manager', '/competitions', p => textReady(p, 'County Sunday League')],
  ['opponents', 'manager', '/opponents', async p => { await p.getByRole('heading', {name:'Opponents'}).waitFor(); await textReady(p, nextOpponent) }],
  ['seasons', 'manager', '/seasons', p => p.locator('main').getByText(/^current$/i).first().waitFor()],
  ['sponsors', 'manager', '/sponsors', p => textReady(p, 'Radford Sports')],
  ['news', 'manager', '/news', p => textReady(p, 'Training on Thursday')],
  ['media', 'manager', '/media', p => textReady(p, 'CLUB PHOTOS')],
  ['reminders', 'manager', '/reminders', p => textReady(p, 'Availability nudges')],
  ['diagnostics', 'manager', '/diagnostics', p => p.getByTestId('device-panel').waitFor()],
]

export async function measureMobileLayout({insets, scale, engine, changedScale}) {
  const root = document.documentElement
  for (const [i, name] of ['--safe-t','--safe-r','--safe-b','--safe-l'].entries())
    root.style.setProperty(name, insets[i] + 'px')
  root.style.setProperty('font-size', (16 * scale / 100) + 'px', 'important')
  window.scrollTo(0,0)
  document.querySelectorAll('[role=dialog], .sheet-body').forEach(el => el.scrollTo(0,0))
  await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))
  if (engine === 'webkit') {
    // A changed root size is observable before Mobile WebKit has
    // recomputed deeply inherited sizes. Keep text size constant across
    // orientations, then let the next text-size group settle once.
    const expected = getComputedStyle(root).fontSize
    if (changedScale) await new Promise(done=>setTimeout(done,750))
    const deadline = performance.now()+3000
    while (getComputedStyle(document.body).fontSize !== expected) {
      if (performance.now()>deadline) throw new Error('Body text did not settle at '+expected)
      await new Promise(requestAnimationFrame)
    }
    await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))
  }
  const dialog = document.querySelector('[role=dialog]')
  const clip = dialog || root
  const targets = [...clip.querySelectorAll('button, a[href], input, select, textarea, summary, [role=button], [role=switch]')]
    .filter(el => !el.closest('[hidden]') && el.getClientRects().length)
  const outside = targets.filter(el => {
    const r = el.getBoundingClientRect()
    return r.left < -1 || r.right > root.clientWidth + 1
  }).map(el => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0,65))
  const below = minimum => targets.filter(el => {
    const r = el.getBoundingClientRect()
    return r.width + 0.1 < minimum || r.height + 0.1 < minimum
  }).length
  function reachability(button) {
    const {left,top,right,bottom,width,height} = button.getBoundingClientRect()
    const viewport = window.visualViewport
    const hit = document.elementFromPoint(left+width/2,top+height/2)
    return {name:button.textContent.trim(),top,bottom,
      visible:left >= -1 && top >= -1 && right <= innerWidth+1 && bottom <= (viewport?.height ?? innerHeight)+1,
      receivesTap:hit && button.contains(hit)}
  }
  const actions = dialog ? [...dialog.querySelectorAll('button')].filter(el =>
    /^(Save line-up|Log result|Save result)$/.test(el.textContent.trim())
  ).map(reachability) : []
  const unsafeChrome = targets.filter(el => {
    if (!el.closest('.app-header,.bottom-nav,.sheet-actions')) return false
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)
    if (!hit || !el.contains(hit)) return false
    return r.top < insets[0]-1 || r.right > innerWidth-insets[1]+1 ||
      r.bottom > innerHeight-insets[2]+1 || r.left < insets[3]-1
  }).map(el => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0,65))
  return {overflow: Math.max(0, root.scrollWidth-root.clientWidth, clip.scrollWidth-clip.clientWidth),
    outside, small:below(44), below48:below(48), targets:targets.length, actions, unsafeChrome}
}
