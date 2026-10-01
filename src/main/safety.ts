import { isAbsolute, relative, resolve } from 'path'
import { fileURLToPath } from 'url'

/**
 * Checks on what the renderer asks the main process to open or read. The renderer shows content strangers send, so
 * it is never trusted with the whole computer: links only open in their usual apps, local files are only read from
 * Moshi's own folders, and downloads never reach this machine or the local network.
 */

/** Links that may be handed to the system: web pages, e-mail and phone numbers. Anything else (file:, ms-*:, search-ms:,
 * custom protocols) is a known way to run things on the computer. */
export function externalUrl(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined
  try {
    const parsed = new URL(url)
    return ['https:', 'http:', 'mailto:', 'tel:'].includes(parsed.protocol) ? parsed.toString() : undefined
  } catch {
    return undefined
  }
}

/** This computer or the local network: never fetched on the renderer's behalf. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host === '0.0.0.0') return true
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
  }
  // IPv6 loopback, link-local, unique-local and IPv4-mapped addresses.
  return host === '::1' || host === '::' || /^(fe8|fe9|fea|feb|fc|fd)/.test(host) || host.startsWith('::ffff:')
}

/** Whether a file: URL points inside one of `roots` (Moshi's own folders). */
export function fileInside(fileUrl: URL, roots: string[]): boolean {
  if (fileUrl.protocol !== 'file:') return false
  let path: string
  try {
    path = resolve(fileURLToPath(fileUrl))
  } catch {
    return false
  }
  return roots.some((root) => {
    const rel = relative(resolve(root), path)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  })
}
