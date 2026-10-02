// Builds resources/bin/moshi-cutout (scripts/mac-cutout/main.swift), for both Mac CPUs; nothing on other systems.
// Runs before dev and before every macOS package, so the helper always matches the source.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') process.exit(0)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'scripts/mac-cutout/main.swift')
const output = join(root, 'resources/bin/moshi-cutout')
const mtime = (path) => {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}
if (mtime(output) > mtime(source)) process.exit(0)
mkdirSync(dirname(output), { recursive: true })
// One universal binary, so an Intel package made on an Apple Silicon Mac (or the other way) still carries a helper
// that runs. Command Line Tools alone cannot link the other CPU's slice: then this Mac's own CPU only (each release
// runner builds its own). macOS 12 is the oldest Electron runs on; the helper says "needs macOS 14" there (exit 5).
const host = process.arch === 'arm64' ? 'arm64' : 'x86_64'
const build = (arch) => {
  const slice = `${output}-${arch}`
  execFileSync('swiftc', ['-O', '-target', `${arch}-apple-macos12.0`, source, '-o', slice], { stdio: arch === host ? 'inherit' : 'pipe' })
  return slice
}
const slices = [build(host)]
try {
  slices.push(build(host === 'arm64' ? 'x86_64' : 'arm64'))
} catch {
  console.warn(`moshi-cutout: ${host} only (this toolchain cannot build the other CPU)`)
}
execFileSync('lipo', ['-create', ...slices, '-output', output], { stdio: 'inherit' })
for (const slice of slices) rmSync(slice)
console.log('built', output)
