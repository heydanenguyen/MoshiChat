import { afterEach, describe, expect, it } from 'vitest'
import { existsSync } from 'fs'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { pruneTemp } from '../src/main/temp-cleanup'

const DAY = 24 * 3600_000
let root = ''

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
})

async function file(path: string, ageDays: number): Promise<string> {
  await writeFile(path, 'x')
  const when = new Date(Date.now() - ageDays * DAY)
  await utimes(path, when, when)
  return path
}

describe('temp cleanup', () => {
  it('removes only old files in Moshi folders and its own loose files', async () => {
    root = await mkdtemp(join(tmpdir(), 'moshi-prune-'))
    await mkdir(join(root, 'unison-gifs'))
    await mkdir(join(root, 'someone-else'))
    const oldGif = await file(join(root, 'unison-gifs', 'a.gif'), 10)
    const newGif = await file(join(root, 'unison-gifs', 'b.gif'), 1)
    const oldVoice = await file(join(root, 'unison-voice-123.m4a'), 10)
    const foreign = await file(join(root, 'someone-else', 'keep.txt'), 30)
    const foreignLoose = await file(join(root, 'report.pdf'), 30)
    expect(await pruneTemp(root, 7 * DAY)).toBe(2)
    expect(existsSync(oldGif)).toBe(false)
    expect(existsSync(oldVoice)).toBe(false)
    expect(existsSync(newGif)).toBe(true)
    expect(existsSync(foreign)).toBe(true)
    expect(existsSync(foreignLoose)).toBe(true)
  })

  it('does nothing when the folders are not there', async () => {
    root = await mkdtemp(join(tmpdir(), 'moshi-prune-'))
    expect(await pruneTemp(root, DAY)).toBe(0)
  })
})
