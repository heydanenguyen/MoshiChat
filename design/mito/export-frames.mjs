// Renders the animated Mito stickers from animation.html into frames/<id>/: one loop at 25 fps (30 for the fast
// ones, written to frames/<id>/fps.txt for build-pack.mjs), transparent,
// 344 × 338 px, without the sticker edge (build-pack.mjs adds it). Each frame is taken in layers: NNN.png is the cat
// (and what it holds), NNN-back.png and NNN-front.png the effects behind and in front of it (confetti, stars, z's,
// motion lines), which get no sticker edge.
//
//   node design/mito/export-frames.mjs [chao tim coc quay gian ngu toasang tuchoi dienthoai khohieu nghilai nhayday]
//
// Needs Playwright and its Chromium, which the app itself does not use (npm i --no-save playwright && npx playwright
// install chromium), or CHROMIUM=/path/to/chromium. Each loop is started at the pose
// of the drawing, so the first frame is also the sticker's still.
import { chromium } from 'playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = process.env.MITO_DIR || dirname(fileURLToPath(import.meta.url))
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
  toasang: { loop: 2.4, start: 0, page: 'sang' },
  tuchoi: { loop: 2.4, start: 0 },
  dienthoai: { loop: 3.2, start: 0 },
  khohieu: { loop: 2.8, start: 0 },
  nghilai: { loop: 2.4, start: 0 },
  // the rope turns fast: 30 fps is two refreshes a frame on a 60 Hz screen, so it turns evenly
  nhayday: { loop: 2.4, start: 0, fps: 30 }
}
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(STICKERS)

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
})
for (const name of names) {
  const { loop, start, page: pageName = name, fps = FPS } = STICKERS[name]
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
  // The layers of the sticker: [effects behind, the cat, effects in front] (either effects layer may be missing).
  const layers = await page.evaluate(() => {
    const kids = [...document.querySelector('#target .stick').children]
    const art = kids.findIndex((k) => k.classList.contains('art'))
    return { back: art > 0, front: art < kids.length - 1 }
  })
  const show = (which) =>
    page.evaluate((which) => {
      const kids = [...document.querySelector('#target .stick').children]
      const art = kids.findIndex((k) => k.classList.contains('art'))
      kids.forEach((k, i) => {
        const role = i < art ? 'back' : i === art ? 'cat' : 'front'
        k.style.visibility = role === which ? 'visible' : 'hidden'
        if (role === 'cat') for (const c of k.querySelectorAll('*')) c.style.visibility = role === which ? 'visible' : 'hidden'
      })
    }, which)
  const n = Math.round(loop * fps)
  writeFileSync(join(out, 'fps.txt'), String(fps))
  for (let i = 0; i < n; i++) {
    await page.evaluate((u) => window.__seekEach(u), (i / n + start) % 1)
    const base = join(out, String(i).padStart(3, '0'))
    const target = await page.$('#target')
    for (const [which, suffix] of [['cat', ''], ['back', '-back'], ['front', '-front']]) {
      if (which !== 'cat' && !layers[which]) continue
      await show(which)
      await target.screenshot({ path: `${base}${suffix}.png`, omitBackground: true })
    }
  }
  await page.close()
  console.log(name, n, 'frames')
}
await browser.close()
