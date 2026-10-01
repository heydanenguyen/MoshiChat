/**
 * GIPHY stickers kept on this computer: the ones you picked ('recent') and the ones friends sent you ('received',
 * noticed as they show in a chat), so either can be sent again in one tap.
 */

export interface SavedGiphySticker {
  id: string
  /** The picture to show in the picker. */
  url: string
  title?: string
}

const KEYS = { recent: 'unison.giphyRecent', received: 'unison.giphyReceived' } as const
const LIMIT = 24

export function loadGiphyStickers(list: keyof typeof KEYS): SavedGiphySticker[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEYS[list]) ?? '[]') as SavedGiphySticker[]
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s?.id === 'string' && /^[A-Za-z0-9]+$/.test(s.id) && typeof s.url === 'string') : []
  } catch {
    return []
  }
}

/** Put a sticker first in a list (once) and return the list. */
export function rememberGiphySticker(list: keyof typeof KEYS, sticker: SavedGiphySticker): SavedGiphySticker[] {
  const current = loadGiphyStickers(list)
  if (current[0]?.id === sticker.id) return current
  const next = [sticker, ...current.filter((s) => s.id !== sticker.id)].slice(0, LIMIT)
  try {
    localStorage.setItem(KEYS[list], JSON.stringify(next))
  } catch {
    /* private mode */
  }
  return next
}
