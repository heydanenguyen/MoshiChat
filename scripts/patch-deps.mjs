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
  },
  {
    // On a 5xx from Facebook, ws3-fca retries the request, reading the "content-type" header to know how. The
    // header is "Content-Type" (axios), so the retry itself threw "Cannot read properties of undefined (reading
    // 'split')" and the message was never sent, nor retried.
    files: ['node_modules/ws3-fca/src/utils/clients.js', 'node_modules/ws3-fca/src/utils/formatters.js'],
    from: 'data.request.headers["content-type"].split(";")[0]',
    to: 'String(data.request.headers["content-type"] ?? data.request.headers["Content-Type"] ?? "").split(";")[0]'
  },
  {
    // ...and the retry posted the form as axios had already encoded it (a string), which ws3-fca's post() walks
    // key by key: one key per character. Turned back into fields, the retry sends the same request again.
    files: ['node_modules/ws3-fca/src/utils/clients.js'],
    from: 'data.request.form,',
    to: '(typeof data.request.form === "string" ? Object.fromEntries(new URLSearchParams(data.request.form)) : data.request.form),'
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
