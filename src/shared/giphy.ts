/**
 * GIPHY stickers. Instagram's sticker tray is GIPHY's library: a sticker sent from Instagram arrives as
 * `animated_media` carrying a GIPHY link, and sending one means picking that same sticker in Instagram's tray.
 */

/** The GIPHY id in a GIPHY media link (`media2.giphy.com/media/<id>/200.gif`, also with a `v1.<token>/` segment). */
export function giphyIdOf(url: string | undefined): string | undefined {
  if (!url) return undefined
  const match = /^https:\/\/(?:[a-z0-9-]+\.)*giphy\.com\/media\/(?:v1\.[^/]+\/)?([A-Za-z0-9]+)\//.exec(url)
  return match?.[1]
}

/** A sticker's picture straight from GIPHY's CDN (stickers keep their transparency in GIF and WebP). */
export function giphyMediaUrl(id: string, rendition: 'giphy.gif' | '200.gif' | '200.webp' = 'giphy.gif'): string {
  return `https://media.giphy.com/media/${encodeURIComponent(id)}/${rendition}`
}

/** `giphy:<id>`, the sticker id Moshi uses for a GIPHY sticker. */
export const isGiphyStickerId = (id: string | undefined): id is `giphy:${string}` => !!id && /^giphy:[A-Za-z0-9]+$/.test(id)

/**
 * Words to search Instagram's tray with to find a sticker again: the search it was picked from, then its title
 * without GIPHY's "Sticker by <channel>" / "GIF" tail, then the title as it is.
 */
export function trayQueries(title: string | undefined, query?: string): string[] {
  const out: string[] = []
  const add = (q: string | undefined): void => {
    const clean = (q ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
    if (clean && !out.some((o) => o.toLowerCase() === clean.toLowerCase())) out.push(clean)
  }
  add(query)
  add(title?.replace(/\s+(sticker|gif)(\s+by\s+.*)?$/i, ''))
  add(title)
  return out
}
