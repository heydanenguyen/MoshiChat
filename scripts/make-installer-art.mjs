// Installer artwork (Windows NSIS wizard), drawn from the logo characters in src/shared/logos.ts.
// Design notes: build/installer/philosophy.md ("Tender Geometry").
//   build/installerSidebar.bmp    164x314  welcome page: the Buddies say hello
//   build/installerFinish.bmp     164x314  finish page: celebration (swapped in at runtime by installer.nsh)
//   build/uninstallerSidebar.bmp  164x314  uninstaller: calm goodbye
//   build/installerHeader.bmp     150x57   header of the inner pages
// Rendered by Chromium (Electron offscreen) so the app's own Plus Jakarta Sans is used, then written as
// 24-bit BMP (the format NSIS needs). Run: npm run installer-art
import { buildSync } from 'esbuild'
import { spawnSync } from 'child_process'
import { mkdir, rm, writeFile } from 'fs/promises'
import { createRequire } from 'module'
import { dirname, join, resolve } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

const bundle = join(root, 'build/.logos.bundle.mjs')
buildSync({ entryPoints: [join(root, 'src/shared/logos.ts')], bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'error' })
const { LOGO_ORDER, LOGOS, logoMarkInner, logoHero } = await import(pathToFileURL(bundle).href)
await rm(bundle, { force: true })

const INK = '#141414'
const fontsCss = pathToFileURL(join(root, 'src/renderer/public/fonts.css')).href
const mono = pathToFileURL(join(root, 'build/installer/fonts/GeistMono-Regular.ttf')).href

const duo = logoHero('buddies')
const duoSvg = (width) =>
  `<svg class="duo" width="${width}" height="${Math.round(width * duo.ratio)}" viewBox="${duo.viewBox}" xmlns="http://www.w3.org/2000/svg">${duo.inner}</svg>`
const mark = (id, size, mood = 'happy') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${logoMarkInner(id, mood)}</svg>`

/** A lattice of dots, like graph paper under watercolour. */
const lattice = (w, h, step, opacity) => {
  let dots = ''
  for (let y = step / 2; y < h; y += step) for (let x = step / 2; x < w; x += step) dots += `<circle cx="${x}" cy="${y}" r="0.55"/>`
  return `<svg class="lattice" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><g fill="#fff" opacity="${opacity}">${dots}</g></svg>`
}

/** Ordered celebration: primitives placed along a golden-angle spiral around (cx, cy). */
const confetti = (w, h, cx, cy) => {
  const colors = LOGO_ORDER.map((id) => LOGOS[id].color)
  const golden = Math.PI * (3 - Math.sqrt(5))
  let shapes = ''
  for (let i = 0; i < 34; i++) {
    const r = 30 + 5.2 * Math.sqrt(i) * 4.2
    const a = i * golden - Math.PI / 2
    const x = cx + r * Math.cos(a) * 0.82
    const y = cy + r * Math.sin(a)
    if (x < 8 || x > w - 8 || y < 30 || y > h - 70) continue
    // keep the centre clear for the characters and the bubble
    if (Math.abs(x - cx) < 52 && Math.abs(y - cy) < 62) continue
    const c = colors[i % colors.length]
    const rot = ((i * 47) % 180) - 90
    const kind = i % 3
    if (kind === 0) shapes += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2" fill="${c}"/>`
    else if (kind === 1)
      shapes += `<rect x="${(x - 3.5).toFixed(1)}" y="${(y - 1.3).toFixed(1)}" width="7" height="2.6" rx="1.3" fill="${c}" transform="rotate(${rot} ${x.toFixed(1)} ${y.toFixed(1)})"/>`
    else
      shapes += `<path d="M${x.toFixed(1)} ${(y - 2.8).toFixed(1)} l2.6 4.6 h-5.2 Z" fill="${c}" transform="rotate(${rot} ${x.toFixed(1)} ${y.toFixed(1)})"/>`
  }
  return `<svg class="confetti" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${shapes}</svg>`
}

const page = (w, h, body, css) => `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${fontsCss}">
<style>
@font-face { font-family: 'Geist Mono'; src: url('${mono}'); }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${w}px; height: ${h}px; overflow: hidden; }
body { position: relative; font-family: 'Plus Jakarta Sans', sans-serif; color: ${INK}; -webkit-font-smoothing: antialiased; }
.mesh, .lattice, .confetti { position: absolute; inset: 0; }
.index { position: absolute; top: 14px; left: 14px; right: 14px; display: flex; justify-content: space-between;
  font-size: 7.5px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(20, 20, 20, 0.5); }
.index .n { font-family: 'Geist Mono', monospace; font-weight: 400; font-size: 8px; letter-spacing: 0.1em; }
.bubble { position: absolute; left: 50%; transform: translateX(-50%); padding: 7px 13px 8px; border-radius: 13px; background: #fff;
  font-weight: 800; font-size: 16px; letter-spacing: -0.02em; white-space: nowrap;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.9) inset, 0 6px 14px rgba(60, 30, 120, 0.12), 0 1px 2px rgba(60, 30, 120, 0.08); }
.bubble::after { content: ''; position: absolute; bottom: -5px; width: 12px; height: 12px; background: #fff; border-radius: 2px; transform: rotate(45deg); }
.figure { position: absolute; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; }
.shadow { width: 76px; height: 9px; margin-top: 2px; border-radius: 50%; background: radial-gradient(closest-side, rgba(40, 20, 90, 0.2), transparent); }
.name { position: absolute; left: 0; right: 0; text-align: center; font-weight: 800; font-size: 19px; letter-spacing: -0.035em; }
.caption { position: absolute; left: 0; right: 0; text-align: center; font-size: 8px; font-weight: 600;
  letter-spacing: 0.06em; color: rgba(20, 20, 20, 0.5); }
${css}
</style></head><body>${body}</body></html>`

const W = 164
const H = 314

const welcome = page(
  W,
  H,
  `<div class="mesh"></div>${lattice(W, H, 9, 0.28)}
  <div class="index"><span class="n">01 / 03</span><span>xin chào</span></div>
  <div class="bubble" style="top: 58px">Xin chào!</div>
  <div class="figure" style="top: 104px">${duoSvg(118)}<div class="shadow"></div></div>
  <div class="name" style="top: 256px">Unison</div>
  <div class="caption" style="top: 281px">mọi cuộc trò chuyện · một nơi</div>`,
  `.mesh { background:
     radial-gradient(70% 45% at 50% 44%, rgba(255, 255, 255, 0.75), transparent 70%),
     radial-gradient(80% 50% at 100% 0%, #ffd3ea, transparent 70%),
     radial-gradient(90% 55% at 0% 100%, #ffe2cc, transparent 70%),
     #cdbbff; }
   .bubble::after { left: 26px; }`
)

const finish = page(
  W,
  H,
  `<div class="mesh"></div>${lattice(W, H, 9, 0.3)}${confetti(W, H, W / 2, 150)}
  <div class="index"><span class="n">03 / 03</span><span>xong rồi</span></div>
  <div class="bubble" style="top: 58px">Xong rồi!</div>
  <div class="figure" style="top: 104px">${duoSvg(118)}<div class="shadow"></div></div>
  <div class="family" style="top: 254px">${LOGO_ORDER.map((id) => mark(id, 17)).join('')}</div>
  <div class="caption" style="top: 282px">cả nhà đã sẵn sàng</div>`,
  `.mesh { background:
     radial-gradient(70% 45% at 50% 44%, rgba(255, 255, 255, 0.8), transparent 70%),
     radial-gradient(80% 50% at 0% 0%, #ffe8a8, transparent 70%),
     radial-gradient(90% 55% at 100% 100%, #ffc9e2, transparent 70%),
     #ffd9c2; }
   .bubble::after { left: 26px; }
   .family { position: absolute; left: 0; right: 0; display: flex; justify-content: center; gap: 5px; }`
)

const goodbye = page(
  W,
  H,
  `<div class="mesh"></div>${lattice(W, H, 9, 0.28)}
  <div class="index"><span class="n">01 / 02</span><span>tạm biệt</span></div>
  <div class="bubble" style="top: 70px">Hẹn gặp lại!</div>
  <div class="figure pair" style="top: 124px"><div class="row">${mark('buddies', 62, 'calm')}${mark('blossom', 50, 'calm')}</div><div class="shadow"></div></div>
  <div class="name" style="top: 256px">Unison</div>
  <div class="caption" style="top: 281px">bộ đôi sẽ nhớ bạn lắm</div>`,
  `.mesh { background:
     radial-gradient(70% 45% at 50% 46%, rgba(255, 255, 255, 0.7), transparent 70%),
     radial-gradient(80% 50% at 100% 0%, #d7e4ff, transparent 70%),
     radial-gradient(90% 55% at 0% 100%, #e6dcff, transparent 70%),
     #c9d6f7; }
   .bubble::after { left: 50%; margin-left: -6px; }
   .pair .row { display: flex; align-items: flex-end; gap: 0; }
   .pair .row svg:last-child { margin-left: -8px; margin-bottom: 2px; }`
)

const header = page(
  150,
  57,
  `<div class="strip">${duoSvg(42)}</div>`,
  `body { background: #fff; }
   .strip { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); display: flex; }
`
)

const outDir = join(root, 'build/installer/.render')
await mkdir(outDir, { recursive: true })
const jobs = []
for (const [name, html, w, h] of [
  ['installerSidebar', welcome, W, H],
  ['installerFinish', finish, W, H],
  ['uninstallerSidebar', goodbye, W, H],
  ['installerHeader', header, 150, 57]
]) {
  const file = join(outDir, `${name}.html`)
  await writeFile(file, html)
  jobs.push({ html: file, width: w, height: h, bmp: join(root, `build/${name}.bmp`), png: join(root, `build/installer/${name}.png`) })
}
await writeFile(join(outDir, 'jobs.json'), JSON.stringify(jobs))

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const result = spawnSync(require('electron'), [join(root, 'scripts/installer-art-capture.cjs'), join(outDir, 'jobs.json')], { stdio: 'inherit', env })
await rm(outDir, { recursive: true, force: true })
if (result.status !== 0) process.exit(result.status ?? 1)
