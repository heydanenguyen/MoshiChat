import { existsSync, renameSync } from 'fs'
import { join } from 'path'

export interface ProfileFs {
  existsSync(path: string): boolean
  renameSync(from: string, to: string): void
}

/**
 * The app used to be called Unison. On the first start under the new name an existing Unison profile
 * (recognised by its unison.json) becomes the Moshi profile, so accounts, sessions and settings carry over.
 * Anything Electron already created under the new name is set aside, never deleted.
 */
export function migrateLegacyProfile(appData: string, userData: string, fs: ProfileFs = { existsSync, renameSync }, now: () => number = Date.now): 'moved' | 'none' {
  const legacy = join(appData, 'Unison')
  if (!fs.existsSync(join(legacy, 'unison.json')) || fs.existsSync(join(userData, 'unison.json'))) return 'none'
  if (fs.existsSync(userData)) fs.renameSync(userData, `${userData}.empty-${now()}`)
  fs.renameSync(legacy, userData)
  return 'moved'
}
