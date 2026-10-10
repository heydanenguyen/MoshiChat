/** One cookie as Electron's `ses.cookies.set` takes it. */
export interface SessionCookie {
  url: string
  name: string
  value: string
  domain?: string
  path: string
  secure: boolean
  httpOnly: boolean
  expirationDate?: number
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
}

type Raw = Record<string, unknown>

const ZALO_HOST = /(^|\.)(zalo\.me|zaloapp\.com|zdn\.vn)$/i

function expiryOf(raw: Raw): number | undefined {
  if (typeof raw.expirationDate === 'number') return raw.expirationDate
  // tough-cookie's serialised form: an ISO date, or "Infinity" for a cookie with no expiry.
  if (typeof raw.expires === 'string' && raw.expires !== 'Infinity') {
    const at = Date.parse(raw.expires)
    return Number.isNaN(at) ? undefined : at / 1000
  }
  if (typeof raw.maxAge === 'number') return Date.now() / 1000 + raw.maxAge
  return undefined
}

function sameSiteOf(value: unknown): SessionCookie['sameSite'] {
  const text = String(value ?? '').toLowerCase()
  if (text === 'none' || text === 'no_restriction') return 'no_restriction'
  if (text === 'lax' || text === 'strict') return text
  return undefined
}

/**
 * zca-js keeps the Zalo login as a list of browser-style cookies, tough-cookie's serialised jar entries, or
 * `{ url, cookies }` around either. Turns any of them into what a browser session takes; entries that are not Zalo's,
 * have no name, or have already expired are left out.
 */
export function zaloSessionCookies(cookie: unknown, now = Date.now()): SessionCookie[] {
  const list: unknown = Array.isArray(cookie) ? cookie : (cookie as { cookies?: unknown } | null | undefined)?.cookies
  if (!Array.isArray(list)) return []
  const out: SessionCookie[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const raw = entry as Raw
    const name = String(raw.name ?? raw.key ?? '')
    if (!name) continue
    const domain = String(raw.domain ?? '').replace(/^\./, '') || 'chat.zalo.me'
    if (!ZALO_HOST.test(domain)) continue
    const expirationDate = expiryOf(raw)
    if (expirationDate !== undefined && expirationDate * 1000 <= now) continue
    const path = typeof raw.path === 'string' && raw.path ? raw.path : '/'
    out.push({
      url: `https://${domain}${path}`,
      name,
      value: String(raw.value ?? ''),
      // Only a cookie meant for the whole domain gets a domain; a host-only one stays host-only.
      domain: raw.hostOnly === true ? undefined : `.${domain}`,
      path,
      secure: true,
      httpOnly: raw.httpOnly === true,
      expirationDate,
      sameSite: sameSiteOf(raw.sameSite)
    })
  }
  return out
}
