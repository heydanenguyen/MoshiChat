// Renders the animated Mito stickers from animation.html into frames/<id>/NNN.png: one loop at 25 fps, transparent,
// 344 × 338 px, without the sticker edge (build-pack.mjs adds it).
//
//   node design/mito/export-frames.mjs [chao tim coc quay gian ngu toasang]
//
// Needs Playwright and its Chromium, which the app itself does not use (npm i --no-save playwright && npx playwright
// install chromium), or CHROMIUM=/path/to/chromium. Each loop is started at the pose
// of the drawing, so the first frame is also the sticker's still.
import { chromium } from 'playwright'
import { mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const FPS = 25
const W = 344
// Sticker id → its loop in seconds, where the loop starts (the drawing's pose), and its name in animation.html.
const STICKERS = {
  chao: { loop: 2.4, start: 0.1 },
  tim: { loop: 2.8, start: 0 },
  coc: { loop: 4, start: 0 },
  quay: { loop: 3.2, start: 0 },
  gian: { loop: 2.2, start: 0 },
  ngu: { loop: 3.6, start: 0 },
  toasang: { loop: 2.4, start: 0, page: 'sang' }
}
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(STICKERS)

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
})
for (const name of names) {
  const { loop, start, page: pageName = name } = STICKERS[name]
  const out = join(here, 'frames', name)
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  const page = await browser.newPage({ viewport: { width: 800, height: 800 }, deviceScaleFactor: 1 })
  await page.goto(pathToFileURL(join(here, 'animation.html')).href)
  await page.waitForFunction(() => typeof window.__seekEach === 'function')
  // One sticker alone on a transparent page, at the export size: everything else hidden, nothing moved.
  await page.addStyleTag({ content: 'html,body{background:transparent!important} body *{visibility:hidden} .stage-img{background:transparent!important;border-radius:0!important}' })
  await page.evaluate(({ name, W }) => {
    const host = document.querySelector(`section .stick[data-sticker="${name}"]`).parentElement
    host.id = 'target'
    host.style.width = W + 'px'
    for (const e of [host, ...host.querySelectorAll('*')]) e.style.visibility = 'visible'
    host.querySelector('.art').style.filter = 'none'
    host.scrollIntoView()
  }, { name: pageName, W })
  const n = Math.round(loop * FPS)
  for (let i = 0; i < n; i++) {
    await page.evaluate((u) => window.__seekEach(u), (i / n + start) % 1)
    await (await page.$('#target')).screenshot({ path: join(out, `${String(i).padStart(3, '0')}.png`), omitBackground: true })
  }
  await page.close()
  console.log(name, n, 'frames')
}
await browser.close()
