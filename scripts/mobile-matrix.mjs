import fs from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { chromium, webkit, devices } from 'playwright'
import { signInAsAuditMember, auditOrigin } from '../e2e/mobileAuditData.js'

import { mobileScreens, measureMobileLayout } from './mobile-scenes.mjs'

// Capture a local production build compiled with VITE_SUPABASE_URL=auditOrigin
// and a dummy anon key. See Docs/MOBILE-MATRIX.md for a reproducible command.
const { values } = parseArgs({ options: {
  url: { type: 'string' }, out: { type: 'string' }, sample: { type: 'boolean' },
  screen: { type: 'string', multiple: true }, engine: { type: 'string', multiple: true },
  cases: { type: 'string' }, 'fail-overflow': { type: 'boolean' },
} })
if (!values.url || !values.out) throw new Error('Pass --url http://127.0.0.1:PORT and --out DIRECTORY')
const base = new URL(values.url)
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('Only loopback builds can be used')
const out = path.resolve(values.out)
await fs.mkdir(out, { recursive: true })
const existingIndex = await fs.readFile(path.join(out,'index.html'),'utf8').catch(error=>{
  if (error.code !== 'ENOENT') throw error
  return ''
})
if (existingIndex && !existingIndex.includes('<title>Notts MvF · Mobile screenshots</title>')) {
  throw new Error('Choose a separate screenshot output directory. This index belongs to another site.')
}
const bundle = (await (await fetch(base)).text()).match(/src="([^"]*\/assets\/index-[^"]+\.js)"/)?.[1]
if (!bundle) throw new Error('The preview must serve a complete Vite production build')
const cases = values.cases ? new Set(JSON.parse(await fs.readFile(values.cases,'utf8'))) : null
const assetPath = (screen, engine, v) => [screen,engine,v.device+'-'+v.orientation+'-'+v.scale+'.jpg'].join('/')

// CSS-pixel viewports in standalone mode. Insets are synthetic fixtures, not
// measured hardware geometry. Both engines use the exact same dimensions.
const sizes = [
  ['iphone-se', 375, 667, 0, 0], ['iphone-15', 393, 852, 59, 34],
  ['iphone-pro-max', 430, 932, 59, 34], ['pixel-8', 412, 915, 24, 24],
  ['galaxy-a', 360, 800, 24, 24], ['fold-cover', 280, 653, 24, 24],
  ['fold-open', 653, 841, 24, 24], ['ipad-mini', 744, 1133, 24, 20],
]
const variants = sizes.flatMap(([device, w, h, top, bottom]) => [false, true].flatMap(landscape =>
  [100, 150, 200].map(scale => ({
    device, viewport: { width: landscape ? h : w, height: landscape ? w : h },
    orientation: landscape ? 'landscape' : 'portrait', scale,
    insets: landscape ? [0, bottom ? Math.min(59, top) : 0, bottom ? 20 : 0, bottom ? Math.min(59, top) : 0] : [top, 0, bottom, 0],
  })) ))
const checks = values.sample ? variants.filter(v =>
  (v.device === 'iphone-15' && v.orientation === 'portrait' && v.scale === 100) ||
  (v.device === 'fold-cover' && v.orientation === 'portrait' && v.scale === 200) ||
  (v.device === 'iphone-se' && v.orientation === 'landscape' && v.scale === 200)) : variants

const screens = mobileScreens.filter(([screen]) => !values.screen || values.screen.includes(screen))
if (!screens.length) throw new Error('No matching screens')

const records = []
const failures = []
async function capture(browser, engine, [screen, role, route, ready]) {
  const selectedChecks = (cases ? checks.filter(v=>cases.has(assetPath(screen,engine,v))) : [...checks])
    .sort((a,b)=>a.scale-b.scale)
  if (!selectedChecks.length) return
  const context = await browser.newContext({
    ...devices[engine === 'chromium' ? 'Pixel 7' : 'iPhone 14'],
    viewport: {width: 393, height: 852}, deviceScaleFactor: 1, hasTouch: true, isMobile: true,
    serviceWorkers: 'block', reducedMotion: 'reduce', timezoneId: 'Europe/London',
    locale: 'en-GB',
  })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', e => pageErrors.push(e.message))
  let current
  let lastScale
  try {
    page.setDefaultTimeout(12000)
    await context.route('**/*', r => new URL(r.request().url()).origin === base.origin ? r.continue() : r.abort())
    if (role !== 'public') await signInAsAuditMember(page, role)
    else await page.route(auditOrigin + '/**', r => r.fulfill({json:[]}))
    await page.goto(new URL(route, base).href)
    await ready(page)
    if (new URL(page.url()).pathname !== route) throw new Error('Expected '+route+' but opened '+page.url())
    await page.evaluate(() => document.fonts.ready)
    await page.waitForFunction(() => {
      const content = document.querySelector('[role=dialog], main > div, form')
      return content && Number(getComputedStyle(content).opacity) >= 0.99
    })
    const directory = path.join(out, screen, engine)
    await fs.mkdir(directory, {recursive:true})
    for (const variant of selectedChecks) {
      current = variant
      await page.setViewportSize(variant.viewport)
      const metrics = await page.evaluate(measureMobileLayout, {...variant,engine,changedScale:lastScale!==variant.scale})
      lastScale = variant.scale
      const asset = assetPath(screen,engine,variant)
      await page.screenshot({path:path.join(out,asset),type:'jpeg',quality:82,scale:'css',animations:'disabled',caret:'hide'})
      records.push({screen,engine,...variant,...metrics,asset,bundle})
    }
    if (pageErrors.length) throw new Error(pageErrors.join('\n'))
    // Preserve measurements if a long matrix is interrupted after this point.
    await fs.writeFile(path.join(directory,'measurements.json'), JSON.stringify(
      records.filter(r=>r.screen===screen && r.engine===engine),null,2))
    console.log(engine, screen, selectedChecks.length)
  } catch (error) {
    console.error(engine,screen,error.message)
    failures.push({engine,screen,variant:current,error:error.message,body:(await page.locator('body').innerText().catch(()=> '')).slice(0,900)})
  } finally { await context.close() }
}

async function run(engine) {
  const browser = await ({chromium,webkit})[engine].launch()
  try {
    const queue = [...screens]
    async function worker() { while (queue.length) await capture(browser,engine,queue.shift()) }
    await Promise.all([worker(),worker()])
  } finally { await browser.close() }
}
const engines = values.engine || ['chromium','webkit']
await Promise.all(engines.map(run))
const captured = records.length
if (values.screen || values.engine || cases) {
  // Rebuild the index after a targeted retry. Unselected captures in the
  // same output directory belong to this build and remain available.
  const selected = row => screens.some(([name])=>name===row.screen) && engines.includes(row.engine) &&
    (!cases || !row.asset || cases.has(row.asset))
  const previous = await fs.readFile(path.join(out,'measurements.json'),'utf8').catch(e => {
    if (e.code !== 'ENOENT') throw e
    return null
  })
  if (previous) {
    const saved = JSON.parse(previous)
    records.push(...saved.records.filter(row=>!selected(row)))
    failures.push(...saved.failures.filter(row=>!selected(row)))
  }
}
records.sort((a,b) => a.asset.localeCompare(b.asset))
await fs.writeFile(path.join(out,'measurements.json'),JSON.stringify({records,failures},null,2))
const perDirectory = Map.groupBy(records,row=>path.dirname(row.asset))
for (const [directory,rows] of perDirectory) {
  await fs.writeFile(path.join(out,directory,'measurements.json'),JSON.stringify(rows,null,2))
}
const html = ['<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Notts MvF · Mobile screenshots</title><style>body{font:1rem system-ui;max-width:80rem;margin:auto;padding:1rem}summary{cursor:pointer;padding:.5rem}ul{columns:3}li{break-inside:avoid;margin:0 0 .4rem}form{display:flex;flex-wrap:wrap;gap:.75rem}label{display:grid;gap:.25rem}select{font:inherit;padding:.4rem}#preview{display:block;max-height:78vh;max-width:100%;margin:1rem 0}@media(max-width:600px){ul{columns:1}}</style><h1>Notts MvF mobile screenshots</h1>',
  '<p>Local stubbed season · synthetic safe areas · browser root text scale · dark theme.</p>',
  '<p>'+records.length+' screenshots · '+failures.length+' capture failures. <a href="measurements.json">Dimensions and measurements</a> · <a href="reproduce/scripts/mobile-matrix.mjs">Capture script</a> · <a href="reproduce/Docs/MOBILE-MATRIX.md">Reproduction instructions</a></p>',
  '<form id="controls"></form><a id="original"><img id="preview" alt="Selected mobile screenshot"></a><h2>All captures</h2>']
for (const screen of new Set(records.map(row=>row.screen))) {
  html.push('<details><summary>'+screen+'</summary><ul>')
  for (const r of records.filter(r=>r.screen===screen)) html.push('<li><a href="'+r.asset+'">'+[r.engine,r.device,r.orientation,r.scale+'%'].join(' · ')+'</a></li>')
  html.push('</ul></details>')
}
// Embed the inventory so the viewer works when opened straight from disk.
html.push('<script>const captures='+JSON.stringify(records.map(({screen,engine,device,orientation,scale,asset}) =>
  ({screen,engine,device,orientation,scale:String(scale),asset})))+';')
html.push(`
const labels={screen:'Screen',engine:'Engine',device:'Device',orientation:'Orientation',scale:'Text size'}
const defaults={screen:'player-hero',engine:'webkit',device:'iphone-15',orientation:'portrait',scale:'100'}
function update(){
  let choices=captures
  for(const [key,label] of Object.entries(labels)){
    let select=document.getElementById(key)
    if(!select){
      const wrapper=document.createElement('label')
      wrapper.textContent=label
      select=document.createElement('select')
      select.id=key
      select.addEventListener('change',update)
      wrapper.append(select)
      document.getElementById('controls').append(wrapper)
    }
    const selected=select.value||defaults[key]
    const options=[...new Set(choices.map(row=>row[key]))]
    select.replaceChildren(...options.map(value=>new Option(key==='scale'?value+'%':value,value)))
    select.value=options.includes(selected)?selected:options[0]
    choices=choices.filter(row=>row[key]===select.value)
  }
  if(choices.length){
    document.getElementById('original').href=choices[0].asset
    document.getElementById('preview').src=choices[0].asset
  }
}
update()
</script>`)
await fs.writeFile(path.join(out,'index.html'),html.join('\n'))
for (const file of ['scripts/mobile-matrix.mjs','scripts/mobile-scenes.mjs','e2e/mobileAuditData.js','e2e/stubSupabase.js','Docs/MOBILE-MATRIX.md']) {
  const copy=path.join(out,'reproduce',file)
  await fs.mkdir(path.dirname(copy),{recursive:true})
  await fs.copyFile(file,copy)
}
const overflow = records.filter(r=>r.overflow>1)
console.log(out, records.length+' captures, '+overflow.length+' overflow measurements, '+failures.length+' failures')
const expected = cases ? cases.size : engines.length*screens.length*checks.length
if (failures.length || captured !== expected || (values['fail-overflow'] && overflow.length)) process.exitCode = 1
