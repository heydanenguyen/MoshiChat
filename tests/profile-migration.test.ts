import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { migrateLegacyProfile } from '../src/main/profile-migration'

const scratch = (): string => mkdtempSync(join(tmpdir(), 'moshi-migrate-'))

describe('migrateLegacyProfile', () => {
  it('moves a Unison profile to the Moshi location on first start', () => {
    const appData = scratch()
    mkdirSync(join(appData, 'Unison', 'Partitions'), { recursive: true })
    writeFileSync(join(appData, 'Unison', 'unison.json'), '{}')
    expect(migrateLegacyProfile(appData, join(appData, 'Moshi'))).toBe('moved')
    expect(existsSync(join(appData, 'Moshi', 'unison.json'))).toBe(true)
    expect(existsSync(join(appData, 'Moshi', 'Partitions'))).toBe(true)
    expect(existsSync(join(appData, 'Unison'))).toBe(false)
  })

  it('sets aside an empty folder Electron already created under the new name', () => {
    const appData = scratch()
    mkdirSync(join(appData, 'Unison'), { recursive: true })
    writeFileSync(join(appData, 'Unison', 'unison.json'), '{}')
    mkdirSync(join(appData, 'Moshi', 'Cache'), { recursive: true })
    expect(migrateLegacyProfile(appData, join(appData, 'Moshi'), undefined, () => 42)).toBe('moved')
    expect(existsSync(join(appData, 'Moshi', 'unison.json'))).toBe(true)
    expect(existsSync(join(appData, 'Moshi.empty-42', 'Cache'))).toBe(true)
  })

  it('leaves everything alone when Moshi already has data or there is no Unison profile', () => {
    const appData = scratch()
    mkdirSync(join(appData, 'Unison'), { recursive: true })
    writeFileSync(join(appData, 'Unison', 'unison.json'), '{}')
    mkdirSync(join(appData, 'Moshi'), { recursive: true })
    writeFileSync(join(appData, 'Moshi', 'unison.json'), '{"newer":true}')
    expect(migrateLegacyProfile(appData, join(appData, 'Moshi'))).toBe('none')
    expect(readdirSync(appData).sort()).toEqual(['Moshi', 'Unison'])
    const empty = scratch()
    expect(migrateLegacyProfile(empty, join(empty, 'Moshi'))).toBe('none')
    expect(readdirSync(empty)).toEqual([])
  })
})
