import { existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => process.cwd() } }))

const { NativeCutoutError, nativeCutout, nativeCutoutAvailable } = await import('../src/main/media/mac-cutout')
// Built by scripts/build-mac-cutout.mjs (npm run dev / the macOS package); absent on other systems and in CI tests.
const helperBuilt = process.platform === 'darwin' && existsSync(join(process.cwd(), 'resources/bin/moshi-cutout'))

describe('macOS cut-out', () => {
  it('tells "nothing to lift" apart from other failures', () => {
    expect(new NativeCutoutError(4, 'no subject').noSubject).toBe(true)
    expect(new NativeCutoutError(3, 'vision failed').noSubject).toBe(false)
    if (process.platform !== 'darwin') expect(nativeCutoutAvailable()).toBe(false)
  })

  it.runIf(helperBuilt && nativeCutoutAvailable())('lifts a subject off its background, and says when there is none', async () => {
    const photo = await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 200, g: 240, b: 140 } } })
      .composite([{ input: Buffer.from('<svg width="400" height="400"><circle cx="200" cy="200" r="120" fill="#5566cc" stroke="#222" stroke-width="8"/></svg>') }])
      .png()
      .toBuffer()
    const cut = await nativeCutout(photo)
    const { data, info } = await sharp(cut).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(data[3]).toBe(0)
    expect(data[((info.height >> 1) * info.width + (info.width >> 1)) * 4 + 3]).toBe(255)
    const plain = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#888888' } }).png().toBuffer()
    await expect(nativeCutout(plain)).rejects.toMatchObject({ noSubject: true })
  }, 30_000)
})
