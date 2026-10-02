// Small fixes to dependencies, applied after every npm install / npm ci (the "postinstall" script). Each one is a
// plain text replacement that is skipped once applied, and says so loudly if the library changed under it.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const fixes = [
  {
    // A person without a profile picture (deactivated or deleted, some Pages) has no big_image_src: reading its
    // .uri threw and took the whole chat list (or chat details) down with it.
    files: ['node_modules/ws3-fca/src/deltas/apis/threads/getThreadList.js', 'node_modules/ws3-fca/src/deltas/apis/threads/getThreadInfo.js'],
    from: 'messaging_actor.big_image_src.uri',
    to: 'messaging_actor.big_image_src?.uri'
  }
]

let failed = false
for (const fix of fixes) {
  for (const file of fix.files) {
    const path = join(root, file)
    let text
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      console.warn(`patch-deps: ${file} not found, skipped`)
      continue
    }
    if (text.includes(fix.to)) continue
    if (!text.includes(fix.from)) {
      console.error(`patch-deps: ${file} no longer contains "${fix.from}"; check whether the fix is still needed`)
      failed = true
      continue
    }
    writeFileSync(path, text.split(fix.from).join(fix.to))
    console.log(`patch-deps: patched ${file}`)
  }
}
if (failed) process.exit(1)
