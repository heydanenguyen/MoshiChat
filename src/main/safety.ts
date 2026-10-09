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

/**
 * Whether the image and media proxies may fetch a link with the platform's signed-in session. Platform CDNs are fine;
 * the sites themselves (facebook.com, instagram.com) only for static pictures such as emoji and icons, so a link in a
 * message can never make Moshi load a page or an action URL as you.
 */
export function proxyAllowed(target: URL, hosts: RegExp): boolean {
  if (target.protocol !== 'https:' || !hosts.test(target.hostname)) return false
  if (!/(^|\.)(facebook|instagram)\.com$/i.test(target.hostname)) return true
  return /^\/(images|static|rsrc\.php|emoji\.php)\//i.test(target.pathname) || /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(target.pathname)
}

/**
 * Whether the app window may navigate to `url`: only its own page (a file: URL's origin is always "null", so origins
 * cannot tell a dropped file from the app) or, in development, the dev server's origin.
 */
export function isAppNavigation(url: string, appPage: string): boolean {
  if (!appPage.startsWith('file:')) {
    try {
      return new URL(url).origin === appPage
    } catch {
      return false
    }
  }
  // The page itself (with a query or fragment), not a sibling file that merely starts with its name.
  return url.startsWith(appPage) && (url.length === appPage.length || /^[?#]/.test(url.slice(appPage.length)))
}

/** Files that run when opened (or install something): shown in their folder instead of being opened. */
const EXECUTABLE = new Set('exe bat cmd com scr pif msi msp lnk hta js jse vbs vbe wsf wsh ps1 reg cpl jar app dmg pkg sh'.split(' '))

export function isExecutableName(name: string): boolean {
  // Windows ignores trailing dots and spaces ("a.exe " is still a.exe).
  const ext = /\.([a-z0-9]+)$/i.exec(name.trim().replace(/[. ]+$/, ''))?.[1]
  return !!ext && EXECUTABLE.has(ext.toLowerCase())
}
