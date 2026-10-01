import { describe, expect, it } from 'vitest'
import { giphyIdOf, giphyMediaUrl, isGiphyStickerId, trayQueries } from '../src/shared/giphy'

describe('GIPHY stickers', () => {
  it('reads the id from GIPHY media links', () => {
    expect(giphyIdOf('https://media2.giphy.com/media/3o7TKSjRrfIPjeiVyM/200.gif?cid=abc&rid=200.gif')).toBe('3o7TKSjRrfIPjeiVyM')
    expect(giphyIdOf('https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/l0MYt5jPR6QX5pnqM/giphy.webp')).toBe('l0MYt5jPR6QX5pnqM')
    expect(giphyIdOf('https://i.giphy.com/media/abc123/200w.gif')).toBe('abc123')
    expect(giphyIdOf('https://scontent.cdninstagram.com/v/t51/123.jpg')).toBeUndefined()
    expect(giphyIdOf('https://evil.com/giphy.com/media/abc/200.gif')).toBeUndefined()
    expect(giphyIdOf(undefined)).toBeUndefined()
  })

  it('builds CDN links and recognises sticker ids', () => {
    expect(giphyMediaUrl('abc')).toBe('https://media.giphy.com/media/abc/giphy.gif')
    expect(giphyMediaUrl('abc', '200.webp')).toBe('https://media.giphy.com/media/abc/200.webp')
    expect(isGiphyStickerId('giphy:abc123')).toBe(true)
    expect(isGiphyStickerId('giphy:../x')).toBe(false)
    expect(isGiphyStickerId('mito:chao')).toBe(false)
  })

  it('searches the tray with the query first, then the title without its tail', () => {
    expect(trayQueries('Happy Cat Sticker by Mito', 'cat')).toEqual(['cat', 'Happy Cat', 'Happy Cat Sticker by Mito'])
    expect(trayQueries('Love GIF', '')).toEqual(['Love', 'Love GIF'])
    expect(trayQueries('wave', 'Wave')).toEqual(['Wave'])
    expect(trayQueries(undefined)).toEqual([])
  })
})
