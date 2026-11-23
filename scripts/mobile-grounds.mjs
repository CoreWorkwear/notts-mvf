import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { parseArgs } from 'node:util'
import { chromium, devices, webkit } from 'playwright'
import sharp from 'sharp'
import { auditOrigin, nextOpponent, signInAsAuditMember } from '../e2e/mobileAuditData.js'
import { measureMobileLayout, mobileScreens } from './mobile-scenes.mjs'

// Use a local Vite production preview compiled against auditOrigin, e.g.
// node scripts/mobile-grounds.mjs --url http://127.0.0.1:4173 --out DIR --photo FILE.jpg
const { values } = parseArgs({ options: {
  url: { type: 'string' }, out: { type: 'string' }, photo: { type: 'string' },
  screen: { type: 'string', multiple: true }, engine: { type: 'string', multiple: true },
} })
if (!values.url || !values.out || !values.photo) throw new Error('Supply a local preview --url, --out directory and --photo JPEG.')
const base = new URL(values.url)
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Use a loopback production preview.')
const indexResponse = await fetch(base)
const bundle = (await indexResponse.text()).match(/src="([^"]*\/assets\/index-[^"]+\.js)"/)?.[1]
if (!indexResponse.ok || !bundle) throw new Error('The preview must serve a Vite production build.')
const photo = await fs.readFile(values.photo)
if (photo[0] !== 0xff || photo[1] !== 0xd8) throw new Error('The club photograph must be a JPEG.')
const photoDigest = createHash('sha256').update(photo).digest('hex')
const photoUrl = new URL('/__capture__/club-match.jpg', base).href
const out = path.resolve(values.out)
await fs.mkdir(out, { recursive: true })
const galleryTitle = '<title>Notts MvF · Appearance comparison</title>'
const existing = await fs.readFile(path.join(out, 'index.html'), 'utf8').catch(error => {
  if (error.code !== 'ENOENT') throw error
  return ''
})
if (existing && !existing.includes(galleryTitle)) throw new Error('Choose a separate gallery directory.')

const viewport = { width: 384, height: 854 }
const insets = [0, 0, 0, 0] // Exact browser content viewport, independent of hardware cut-outs.
const grounds = ['light', 'dark']
const engines = values.engine || ['chromium', 'webkit']
const enginesAvailable = { chromium, webkit }
const button = (p, name) => p.getByRole('button', { name, exact: typeof name === 'string' }).first()
function sheet(open, heading) {
  return async p => {
    await button(p, open).click()
    await p.getByRole('dialog').getByRole('heading', { name: heading, exact: true }).waitFor()
  }
}
const extraScreens = [
  ['sign-in', 'public', '/fixtures', p => button(p, 'Sign in').waitFor()],
  ['reset-password', 'public', '/fixtures', async p => { await button(p, /forgot password/i).click(); await button(p, 'Send reset link').waitFor() }],
  ['new-password', 'player', '/fixtures', p => p.getByLabel('Confirm password').waitFor()],
  ['sign-out', 'player', '/you', async p => { await button(p, 'Sign out').click(); await p.getByRole('dialog').getByRole('button',{name:'Sign out'}).waitFor() }],
  ['community-hero', 'player', '/fixtures', p => p.getByRole('heading', { name: 'Trent Vale', exact: true }).waitFor()],
  ['confirmed-hero', 'player', '/fixtures', async p => { await p.getByRole('heading', { name: nextOpponent }).waitFor(); await p.locator('.hero button[aria-pressed="true"]').waitFor() }],
  ['fixture-replies', 'player', '/fixtures', async p => { await button(p, /^who.s in$/i).click(); await p.getByRole('dialog').getByText(/Alex/).first().waitFor() }],
  ['player-results', 'player', '/results', p => button(p, /match centre/i).waitFor()],
  ['edit-fixture', 'manager', '/fixtures', async p => { await button(p, 'Edit fixture').click(); await p.getByRole('dialog').getByRole('button', {name:'Save changes'}).waitFor() }],
  ['add-player', 'manager', '/players', sheet(/add a player/i, 'New player')],
  ['edit-player', 'manager', '/players', sheet(/Alex Wood/, 'Alex Wood')],
  ['add-opponent', 'manager', '/opponents', sheet(/add an opponent/i, 'New opponent')],
  ['add-competition', 'manager', '/competitions', sheet(/add a competition/i, 'New competition')],
  ['registered-squad', 'manager', '/competitions', async p => { await button(p, 'Squad').click(); await p.getByRole('dialog').getByText(/Alex Wood/).waitFor() }],
  ['add-season', 'manager', '/seasons', sheet(/start a new season/i, 'New season')],
  ['add-sponsor', 'manager', '/sponsors', sheet(/add a sponsor/i, 'New sponsor')],
  ['post-news', 'manager', '/news', sheet(/post news/i, 'Post news')],
  ['edit-table', 'manager', '/club', sheet('Edit table', 'Edit the table')],
  ['club-photo', 'manager', '/media', sheet('Open club photo 1', 'Club photo 1')],
]
const allScreens = [...mobileScreens, ...extraScreens]
const scenes = allScreens.filter(([name]) => !values.screen || values.screen.includes(name))
const knownScreens = new Set(allScreens.map(([name]) => name))
if (values.screen?.some(name => !knownScreens.has(name)) || engines.some(name => !enginesAvailable[name])) {
  throw new Error('Unknown screen or engine.')
}
const photoSurfaces = {
  'player-hero':'.hero-bg', 'confirmed-hero':'.hero-bg', 'manager-hero':'.hero-bg', 'community-hero':'.hero-bg',
  'fixture-detail':'.det-hero', 'fixture-replies':'.det-hero', 'line-up':'.det-hero',
  results:'.result-hero', 'player-results':'.result-hero', 'match-centre':'.mc-hero', pending:'.hero-bg',
}

// Inspect opaque, unoccluded text on flat surfaces. A WCAG computation on a
// gradient/photo without its rendered pixels would give misleading results.
function findLowContrastText() {
  function rgb(css) {
    const match = css.match(/^rgb\((\d+), (\d+), (\d+)\)$/)
    return match && match.slice(1).map(Number)
  }
  function luminance(channels) {
    const [r,g,b] = channels.map(value => {
      const c = value/255
      return c <= .04045 ? c/12.92 : ((c+.055)/1.055)**2.4
    })
    return .2126*r+.7152*g+.0722*b
  }
  const findings = []
  const tree = document.createTreeWalker(document.querySelector('[role=dialog]') || document.body, NodeFilter.SHOW_TEXT)
  while (tree.nextNode()) {
    const node = tree.currentNode, el = node.parentElement, text = node.textContent.trim()
    if (!text || el.closest('style,script,option,[hidden],:disabled,[aria-disabled=true],.hero-poster,.det-hero,.mc-hero,.result-hero')) continue
    const range = document.createRange()
    range.selectNodeContents(node)
    const rect = Array.from(range.getClientRects()).find(r=>r.width>1 && r.top>=0 && r.bottom<=innerHeight)
    if (!rect) continue
    const hit = document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2)
    if (hit !== el && !el.contains(hit)) continue
    const fg = getComputedStyle(el), colour = rgb(fg.color)
    if (!colour || fg.textShadow !== 'none') continue
    let background
    for (let ancestor=el; ancestor; ancestor=ancestor.parentElement) {
      const style = getComputedStyle(ancestor)
      if (Number(style.opacity)<.99 || style.backgroundImage!=='none') break
      background = rgb(style.backgroundColor)
      if (background || style.backgroundColor!=='rgba(0, 0, 0, 0)') break
    }
    if (!background) continue
    const [a,b]=[luminance(colour),luminance(background)].sort((a,b)=>b-a)
    const contrast=(a+.05)/(b+.05), px=parseFloat(fg.fontSize)
    const minimum = px>=24 || (Number(fg.fontWeight)>=700 && px>=18.67) ? 3 : 4.5
    if (contrast<minimum) findings.push({text:text.slice(0,70), colour, background, ratio:Number(contrast.toFixed(2)), minimum})
  }
  return findings
}

// Some WebKit renderers report the correct weight and glyph advance for a
// variable face while painting regular-weight outlines at every setting.
function checkClubFontPaint() {
  const hasClubFont = [...document.fonts].some(face => face.family.replaceAll('"', '') === 'Instrument Sans' && face.status === 'loaded')
  if (!hasClubFont) throw new Error('The Instrument Sans font has not loaded.')
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 68
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  function paintedArea(weight) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = weight + ' 40px "Instrument Sans"'
    ctx.fillText('Fixtures next Sunday', 0, 45)
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let coverage = 0
    for (let i = 3; i < pixels.length; i += 4) coverage += pixels[i] / 255
    return Math.round(coverage)
  }
  const regular = paintedArea(400), bold = paintedArea(700)
  if (regular === 0 || bold < regular * 1.05) throw new Error('Instrument Sans failed to paint visibly distinct regular and bold weights.')
  return { regular, bold }
}

async function capture(browser, engine, [screen, role, route, ready], ground) {
  const context = await browser.newContext({
    ...devices[engine === 'webkit' ? 'iPhone 14' : 'Pixel 7'], viewport, screen: viewport,
    deviceScaleFactor: 1, hasTouch: true, isMobile: true, colorScheme: ground,
    serviceWorkers: 'block', reducedMotion: 'reduce', timezoneId: 'Europe/London', locale: 'en-GB',
  })
  const page = await context.newPage()
  const errors = []
  let imageLoaded = false
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', r => { if (r.url() === photoUrl && r.status() === 200) imageLoaded = true })
  try {
    page.setDefaultTimeout(14000)
    await context.route('**/*', r => {
      if (r.request().url() === photoUrl) return r.fulfill({body: photo, contentType:'image/jpeg'})
      return new URL(r.request().url()).origin === base.origin ? r.continue() : r.abort()
    })
    if (role === 'public') await page.route(auditOrigin + '/**', r => r.fulfill({json:[]}))
    else await signInAsAuditMember(page, role, auditOrigin, {
      photoUrl, squad: screen === 'community-hero' ? 'community' : 'xl', answered: screen === 'confirmed-hero',
    })
    if (screen === 'new-password') await page.addInitScript(() => sessionStorage.setItem('mvf:passwordRecovery', '1'))
    await page.goto(new URL(route, base).href)
    await ready(page)
    if (new URL(page.url()).pathname !== route) throw new Error('Expected '+route+', opened '+page.url())
    if (screen === 'players') {
      const signOff = page.getByRole('button', { name: /^Sign off\b/i })
      await signOff.waitFor()
      const separateAction = await signOff.evaluate(el => el.tagName === 'BUTTON' && !el.parentElement.closest('button,[role=button]'))
      if (!separateAction) throw new Error('Pending-player sign-off must be a separate native button.')
    }
    await page.waitForFunction(expected => document.documentElement.dataset.ground === expected, ground, {timeout:5000})
    await page.evaluate(() => document.fonts.ready)
    await page.waitForFunction(() => {
      const body = document.querySelector('[role=dialog], main > div, form')
      return body && Number(getComputedStyle(body).opacity) >= .99
    })
    if (photoSurfaces[screen]) {
      await page.waitForFunction(({selector,url}) => {
        const node = document.querySelector(selector)
        return node && getComputedStyle(node).backgroundImage.includes(url)
      }, {selector:photoSurfaces[screen], url:photoUrl})
      if (!imageLoaded) await page.waitForResponse(r=>r.url()===photoUrl && r.status()===200)
    }
    if (screen === 'media' || screen === 'club-photo') {
      const image = page.locator(screen === 'media' ? '.photo-cell img' : '.photo-viewer').first()
      await image.evaluate(el=>el.decode())
      if (await image.evaluate(el => el.currentSrc) !== photoUrl) throw new Error('Expected the local club photograph.')
    }
    const metrics = await page.evaluate(measureMobileLayout,{ insets, scale:100, engine, changedScale:false })
    const contrastFindings = await page.evaluate(findLowContrastText)
    const fontPaint = screen === 'player-hero' ? await page.evaluate(checkClubFontPaint) : undefined
    const appearance = await page.evaluate(() => ({
      ground: document.documentElement.dataset.ground, surface: getComputedStyle(document.body).backgroundColor,
      displayFont: getComputedStyle(document.querySelector('h1,h2') || document.body).fontFamily,
      bodyFont: getComputedStyle(document.body).fontFamily,
    }))
    const asset = [screen, engine, ground+'.png'].join('/')
    await fs.mkdir(path.dirname(path.join(out,asset)),{recursive:true})
    const bytes = await page.screenshot({path:path.join(out,asset),type:'png',scale:'css',animations:'disabled',caret:'hide'})
    if (bytes.readUInt32BE(16)!==384 || bytes.readUInt32BE(20)!==854) throw new Error('Incorrect capture dimensions.')
    if (errors.length) throw new Error(errors.join('\n'))
    return {screen, role, route, engine, ground, asset, viewport, bundle, appearance, imageLoaded, contrastFindings, fontPaint, ...metrics}
  } finally { await context.close() }
}

const records = []
const failures = []
async function run(engine) {
  const browser = await enginesAvailable[engine].launch()
  const work = scenes.flatMap(scene=>grounds.map(ground=>({scene,ground})))
  try {
    async function worker() {
      while (work.length) {
        const {scene,ground} = work.shift()
        try { records.push(await capture(browser,engine,scene,ground)) }
        catch (error) { failures.push({screen:scene[0],engine,ground,error:error.message}); console.error(engine,scene[0],ground,error.message) }
      }
    }
    await Promise.all([worker(),worker()])
  } finally { await browser.close() }
}
await Promise.all(engines.map(run))
const retries = values.engine || values.screen
if (retries) {
  const selected = row => scenes.some(([name])=>name===row.screen) && engines.includes(row.engine)
  const previous = await fs.readFile(path.join(out,'measurements.json'),'utf8').catch(error=>{
    if(error.code !== 'ENOENT') throw error
  })
  if (previous) {
    const saved = JSON.parse(previous)
    if (saved.photoSha256 !== photoDigest) throw new Error('Use a fresh gallery when changing the source photograph.')
    records.push(...saved.records.filter(row=>!selected(row)))
    failures.push(...saved.failures.filter(row=>!selected(row)))
  }
}
records.sort((a,b)=>a.asset.localeCompare(b.asset))
await fs.writeFile(path.join(out,'measurements.json'),JSON.stringify({photoSha256:photoDigest,records,failures},null,2))
const names = [...new Set(records.map(r=>r.screen))]
const orderedNames = allScreens.map(([name])=>name).filter(name=>names.includes(name))
const availableEngines = [...new Set(records.map(r=>r.engine))]
const pairs = [...Map.groupBy(records, r=>r.screen+'/'+r.engine).values()]
const sameGrounds = pairs.filter(([a,b])=>a && b && a.appearance.surface===b.appearance.surface)
const overflow = records.filter(r=>r.overflow>1)
const badActions = records.filter(r=>r.actions.some(a=>!a.visible || !a.receivesTap))
const lowContrast = records.filter(r=>r.contrastFindings?.length)
const confirmed = records.filter(r => r.screen === 'confirmed-hero' && r.engine === 'chromium')
const hasFixturePair = grounds.every(ground => confirmed.some(r => r.ground === ground))
if (hasFixturePair) {
  const panels = grounds.map((ground, i) => ({
    input: path.join(out, confirmed.find(r => r.ground === ground).asset),
    left: i * viewport.width, top: 0,
  }))
  await sharp({create: {width: viewport.width * 2, height: viewport.height, channels: 3, background: '#ffffff'}})
    .composite(panels).png().toFile(path.join(out, 'fixtures-both.png'))
}
const gallery = `<!doctype html><html lang="en-GB"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${galleryTitle}
<style>*{box-sizing:border-box}body{background:#e9e9e4;color:#202620;font:1rem "Instrument Sans",system-ui,sans-serif;max-width:60rem;margin:0 auto;padding:1rem}h1{margin:.5rem 0;font-size:1.65rem}p{margin:.5rem 0}form{display:flex;align-items:end;gap:1rem;flex-wrap:wrap;margin:1rem 0}label{display:grid;gap:.25rem}select,button{font:inherit;min-height:2.75rem;padding:.4rem .65rem}.pair{display:grid;grid-template-columns:repeat(2,minmax(0,384px));gap:1rem;align-items:start}figure{margin:0}figcaption{font-weight:650;margin-bottom:.4rem}img{display:block;width:100%;height:auto;border:1px solid #8a928a}a{color:#244d35}small{display:block;color:#414a42;margin-top:1rem}@media(max-width:580px){body{padding:.65rem}.pair{gap:.45rem}form{gap:.5rem}}</style>
<h1>Notts MvF screen comparison</h1>
<p>384 × 854 CSS pixels · ${orderedNames.length} screens · ${records.length} screenshots</p>
<form id="filters"><label>Screen<select id="screen"></select></label><label>Browser engine<select id="engine"></select></label><button id="prev" type="button">Previous</button><button id="next" type="button">Next</button></form>
<div class="pair">${grounds.map(g=>'<figure><figcaption>'+g[0].toUpperCase()+g.slice(1)+'</figcaption><a id="'+g+'-link"><img width="384" height="854" id="'+g+'-image" alt="'+g+' appearance"></a></figure>').join('')}</div>
<small>Local production build with fictional squad data and a club gallery photograph. Open a screenshot at its original dimensions. <a href="measurements.json">Capture measurements</a> ${hasFixturePair ? '· <a href="fixtures-both.png">Confirmed fixture comparison</a>' : ''}</small>
<script>const groundNames=${JSON.stringify(grounds)},screens=${JSON.stringify(orderedNames)},engines=${JSON.stringify(availableEngines)},assets=${JSON.stringify(Object.fromEntries(records.map(r=>[r.screen+'/'+r.engine+'/'+r.ground,r.asset])))};
const screenChoice=document.getElementById('screen'),engineChoice=document.getElementById('engine');
screens.forEach(s=>screenChoice.add(new Option(s.replaceAll('-',' '),s)));engines.forEach(e=>engineChoice.add(new Option(e==='webkit'?'WebKit':'Chromium',e)));
function show(){for(const ground of groundNames){const url=assets[screenChoice.value+'/'+engineChoice.value+'/'+ground],img=document.getElementById(ground+'-image'),link=document.getElementById(ground+'-link');if(url){img.src=url;link.href=url;img.alt=screenChoice.value.replaceAll('-',' ')+' in '+ground+' appearance'}else{img.removeAttribute('src');link.removeAttribute('href');img.alt='Capture unavailable'}}}
document.getElementById('filters').addEventListener('change',show);for(const [id,d] of [['prev',-1],['next',1]])document.getElementById(id).onclick=()=>{screenChoice.selectedIndex=(screenChoice.selectedIndex+d+screens.length)%screens.length;show()};show();</script></html>`
await fs.writeFile(path.join(out,'index.html'),gallery)
console.log(out, records.length+' captures, '+failures.length+' capture failures, '+overflow.length+' overflow, '+badActions.length+' unreachable saves, '+sameGrounds.length+' identical ground colours, '+lowContrast.length+' screens with low-contrast flat text')
if(failures.length || overflow.length || badActions.length || sameGrounds.length || lowContrast.length) process.exitCode=1
