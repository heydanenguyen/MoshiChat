/**
 * Picture hosts Moshi may fetch through its own sessions (unison-img://): the platforms' image and file CDNs.
 * The renderer uses the same list to decide when a picture can get a light preview copy.
 */
export const IMAGE_HOSTS = /(^|\.)(fbcdn\.net|cdninstagram\.com|instagram\.com|facebook\.com|fbsbx\.com|zdn\.vn|zadn\.vn|dlfl\.vn|zaloapp\.com|telegram\.org|t\.me|whatsapp\.net)$/i

/** File names that are videos (a video sent "as a file" still deserves a player). */
export const VIDEO_FILE = /\.(mp4|m4v|mov|webm)$/i

/**
 * A remote picture through Moshi's preview cache, about `width` pixels wide: light enough for a bubble or a grid,
 * while Download still saves the original. Anything Moshi cannot fetch itself is left as it is.
 */
export function previewSrc(url: string | undefined, width: number): string | undefined {
  if (!url || !/^https:/.test(url)) return url
  try {
    if (!IMAGE_HOSTS.test(new URL(url).hostname)) return url
  } catch {
    return url
  }
  return `unison-img://img/?u=${encodeURIComponent(url)}&w=${Math.round(width)}`
}

/** A remote picture as it is (animation kept) through Moshi's own session and referer; others as they are. */
export function imageSrc(url: string | undefined): string | undefined {
  if (!url || !/^https:/.test(url)) return url
  try {
    if (!IMAGE_HOSTS.test(new URL(url).hostname)) return url
  } catch {
    return url
  }
  return `unison-img://img/?u=${encodeURIComponent(url)}`
}

/** A platform's video or voice file through Moshi (right referer, seeking passed through); others as they are. */
export function mediaSrc(url: string | undefined): string | undefined {
  if (!url || !/^https:/.test(url)) return url
  try {
    if (!IMAGE_HOSTS.test(new URL(url).hostname)) return url
  } catch {
    return url
  }
  return `unison-media://v/?u=${encodeURIComponent(url)}`
}
