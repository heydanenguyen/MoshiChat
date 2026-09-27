// Builds the branded setup: dist/Unison-Setup-<version>.exe
//   1. character art from src/shared/logos.ts -> PNG (orange and pink buddies separately so they can
//      move on their own, plus a blink frame)
//   2. "Unison Uninstall.exe": the same program without a payload (goodbye / uninstall mode)
//   3. the setup: WPF front end + the electron-builder NSIS package (dist/unison-core-<version>.exe),
//      which it runs silently
// Needs the .NET SDK (Roslyn csc) and .NET Framework 4.8 (part of Windows 10/11). Run after electron-builder:
//   npm run dist
import { buildSync } from 'esbuild'
import sharp from 'sharp'
import { execFileSync } from 'child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const core = join(root, 'dist', `unison-core-${version}.exe`)
if (!existsSync(core)) throw new Error(`Missing ${core}: run electron-builder first (npm run dist)`)

const work = join(root, 'build/.setup')
await rm(work, { recursive: true, force: true })
await mkdir(work, { recursive: true })

// ------------------------------------------------------------------ art
const bundle = join(work, 'logos.bundle.mjs')
buildSync({ entryPoints: [join(root, 'src/shared/logos.ts')], bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'error' })
const { logoHero, logoMarkSvg } = await import(pathToFileURL(bundle).href)

async function png(svg, width, height, file) {
  const viewBoxWidth = Number(/viewBox="[\d.-]+ [\d.-]+ ([\d.]+)/.exec(svg)?.[1] ?? 64)
  await sharp(Buffer.from(svg), { density: Math.max(1, Math.ceil(((72 * width) / viewBoxWidth) * 2)) })
    .resize(width, height)
    .png({ compressionLevel: 9 })
    .toFile(join(work, file))
  return file
}

const duo = logoHero('buddies')
const split = duo.inner.indexOf('<g class="buddy-body">')
const pinkInner = duo.inner.slice(0, split)
const orangeInner = duo.inner.slice(split)
// eyes shut: squash the eye group around its centre line (y = 610 in the duo's coordinates)
const blinkInner = orangeInner.replace('<g class="buddy-eyes">', '<g class="buddy-eyes" transform="translate(0 610) scale(1 0.12) translate(0 -610)">')
const duoSvg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${duo.viewBox}">${inner}</svg>`
// 3x the on-screen size (164 x 176) so it stays crisp on high-DPI screens
const DW = 492
const DH = Math.round(DW * duo.ratio)
const assets = [
  await png(duoSvg(pinkInner), DW, DH, 'duo-pink.png'),
  await png(duoSvg(orangeInner), DW, DH, 'duo-orange.png'),
  await png(duoSvg(blinkInner), DW, DH, 'duo-orange-blink.png'),
  await png(logoMarkSvg('buddies', 'calm'), 312, 312, 'calm-buddies.png'),
  await png(logoMarkSvg('blossom', 'calm'), 240, 240, 'calm-blossom.png'),
  await png(logoMarkSvg('buddies'), 72, 72, 'logo-small.png')
]
await sharp(join(root, 'build/icon.png')).resize(64, 64).png().toFile(join(work, 'icon.png'))
assets.push('icon.png')

// ------------------------------------------------------------------ compile
const dotnetRoot = process.env.DOTNET_ROOT || join(process.env.USERPROFILE ?? '', '.dotnet')
const dotnet = [join(dotnetRoot, 'dotnet.exe'), 'C:/Program Files/dotnet/dotnet.exe'].find(existsSync)
const sdkDir = [join(dotnetRoot, 'sdk'), 'C:/Program Files/dotnet/sdk'].find((d) => existsSync(d) && readdirSync(d).length)
if (!dotnet || !sdkDir) throw new Error('The .NET SDK is needed to build the setup (Roslyn compiler)')
const sdk = readdirSync(sdkDir).filter((v) => /^\d/.test(v)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop()
const csc = join(sdkDir, sdk, 'Roslyn/bincore/csc.dll')
const fx = 'C:/Windows/Microsoft.NET/Framework64/v4.0.30319'
const refs = ['mscorlib.dll', 'System.dll', 'System.Core.dll', 'System.Xaml.dll', 'WPF/WindowsBase.dll', 'WPF/PresentationCore.dll', 'WPF/PresentationFramework.dll'].map((r) => `-r:${fx}/${r}`)

function dirSize(dir) {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    total += entry.isDirectory() ? dirSize(p) : statSync(p).size
  }
  return total
}
await writeFile(join(work, 'version.txt'), version)
await writeFile(join(work, 'expected.txt'), String(dirSize(join(root, 'dist/win-unpacked'))))

const res = (file, name = file) => `-resource:${join(work, file)},${name}`
const common = [
  csc,
  '-nologo',
  '-noconfig',
  '-nostdlib',
  '-langversion:latest',
  '-target:winexe',
  '-optimize+',
  '-platform:anycpu',
  `-win32icon:${join(root, 'build/icon.ico')}`,
  `-win32manifest:${join(root, 'setup/app.manifest')}`,
  ...refs,
  `-resource:${join(root, 'setup/Window.xaml')},Window.xaml`,
  ...assets.map((a) => res(a)),
  res('version.txt')
]

const uninstaller = join(work, 'Unison Uninstall.exe')
execFileSync(dotnet, [...common, `-out:${uninstaller}`, join(root, 'setup/UnisonSetup.cs')], { stdio: 'inherit' })

const setup = join(root, 'dist', `Unison-Setup-${version}.exe`)
execFileSync(
  dotnet,
  [...common, res('expected.txt'), `-resource:${uninstaller},uninstaller.exe`, `-resource:${core},payload.exe`, `-out:${setup}`, join(root, 'setup/UnisonSetup.cs')],
  { stdio: 'inherit' }
)
await rm(work, { recursive: true, force: true })
console.log(`setup: ${setup} (${(statSync(setup).size / 1048576).toFixed(1)} MB)`)
