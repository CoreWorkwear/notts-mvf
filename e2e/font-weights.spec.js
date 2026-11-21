import { expect, test } from '@playwright/test'

test('Instrument Sans paints distinct outlines at each weight used by the app', async ({ page }) => {
  await page.goto('/')
  const weights = [400, 500, 600, 650, 700]
  const ink = await page.evaluate(async values => {
    const canvas = document.createElement('canvas')
    canvas.width = 500
    canvas.height = 48
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const totals = []
    for (const weight of values) {
      const font = weight + ' 32px "Instrument Sans"'
      if (!(await document.fonts.load(font)).length) throw Error('Instrument Sans did not load at ' + weight)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.font = font
      ctx.fillText('Fixtures Sherwood Athletic', 0, 36)
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      let coverage = 0
      for (let alpha = 3; alpha < data.length; alpha += 4) coverage += data[alpha]
      totals.push(coverage)
    }
    return totals
  }, weights)
  // WebKit's Windows port advanced the variable glyphs at their correct
  // widths but drew the regular outlines at every weight. Measure actual ink.
  for (let i = 1; i < weights.length; i++) {
    expect(ink[i], 'ink at ' + weights[i]).toBeGreaterThan(ink[i - 1] * 1.025)
  }
})
