import type { Message } from '@shared/types'

/**
 * How tall a sender's run of messages will be, before it is drawn. The thread only draws the rows on screen; the rest
 * are placed by this guess until measured, and when a row scrolled into view turns out taller than guessed the view
 * is shifted to keep what is on screen still. A flat 44 px a message made every sticker (~124 px) and photo
 * (~220-350 px) shift the view as it came in from the top, so scrolling up through them stuttered. Measured in the
 * app (Moshi and Pals alike): a run is 6 px plus, per message, 20 px and 21 px a line of text, 124 px a sticker, the
 * picture's own height (at most ~283 px wide, 342 px tall) for a photo, 44 px more with a quote, 14 px with reactions.
 */
const RUN = 6
const MESSAGE = 20
const LINE = 21
const STICKER = 124
const QUOTE = 44
const REACTIONS = 14
const FILE = 64
const PHOTO_WIDTH = 283
const PHOTO_MAX = 342
/** Characters on a line of a bubble at a usual window width; a guess, which is all this needs. */
const CHARS_PER_LINE = 60

const isPhoto = (kind: string): boolean => kind === 'image' || kind === 'video'

function textLines(text: string): number {
  return text
    .trim()
    .split('\n')
    .reduce((lines, line) => lines + Math.max(1, Math.ceil(line.length / CHARS_PER_LINE)), 0)
}

export function estimateMessage(message: Message): number {
  let height = 0
  const sticker = message.attachments.some((a) => a.kind === 'sticker')
  if (sticker) height = STICKER
  else {
    const photos = message.attachments.filter((a) => isPhoto(a.kind))
    if (photos.length > 1) height += 150 * Math.ceil(photos.length / 2)
    else if (photos.length === 1) {
      const { width, height: h } = photos[0]
      height += width && h ? Math.min(PHOTO_MAX, (PHOTO_WIDTH * h) / width) + 8 : 220
    }
    height += message.attachments.filter((a) => !isPhoto(a.kind)).length * FILE
    if (message.text.trim()) height += MESSAGE + LINE * textLines(message.text)
    if (!height) height = MESSAGE + LINE
  }
  if (message.replyTo) height += QUOTE
  if (message.reactions.length) height += REACTIONS
  return height
}

/** A run of messages from one sender; photos sent one after another sit together as an album (two to a row). */
export function estimateRun(messages: Message[]): number {
  const photoOnly = (m: Message): boolean => !m.text.trim() && !m.replyTo && m.attachments.length > 0 && m.attachments.every((a) => isPhoto(a.kind))
  let height = RUN
  let album: Message[] = []
  const closeAlbum = (): void => {
    if (album.length === 1) height += estimateMessage(album[0])
    else if (album.length > 1) height += 150 * Math.ceil(album.length / 2)
    album = []
  }
  for (const message of messages) {
    if (photoOnly(message)) {
      album.push(message)
      continue
    }
    closeAlbum()
    height += estimateMessage(message)
  }
  closeAlbum()
  return height
}
