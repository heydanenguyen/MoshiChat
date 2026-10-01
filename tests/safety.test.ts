import { describe, expect, it } from 'vitest'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { externalUrl, fileInside, isPrivateHost } from '../src/main/safety'

describe('what the renderer may ask for', () => {
  it('opens only web, mail and phone links', () => {
    expect(externalUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(externalUrl('http://example.com')).toBe('http://example.com/')
    expect(externalUrl('mailto:a@b.c')).toBe('mailto:a@b.c')
    expect(externalUrl('tel:+84123')).toBe('tel:+84123')
    for (const bad of ['file:///C:/Windows/System32/calc.exe', 'ms-msdt:/id', 'search-ms:query=x', 'javascript:alert(1)', 'smb://host/share', 'not a url', 42, undefined]) {
      expect(externalUrl(bad)).toBeUndefined()
    }
  })

  it('never fetches this computer or the local network', () => {
    for (const host of ['localhost', 'app.localhost', 'printer.local', '127.0.0.1', '10.1.2.3', '192.168.1.1', '172.16.0.1', '172.31.255.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '[::1]', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateHost(host), host).toBe(true)
    }
    for (const host of ['scontent.cdninstagram.com', 'media.giphy.com', '8.8.8.8', '172.32.0.1', '192.169.0.1']) {
      expect(isPrivateHost(host), host).toBe(false)
    }
  })

  it('reads local files only inside Moshi folders', () => {
    const root = join(process.cwd(), 'tmp-root')
    expect(fileInside(pathToFileURL(join(root, 'stickers', 'a.png')), [root])).toBe(true)
    expect(fileInside(pathToFileURL(join(root, '..', 'secret.txt')), [root])).toBe(false)
    expect(fileInside(pathToFileURL(join(process.cwd(), 'tmp-root-evil', 'a.png')), [root])).toBe(false)
    expect(fileInside(pathToFileURL(root), [root])).toBe(false)
    expect(fileInside(new URL('https://example.com/a.png'), [root])).toBe(false)
  })
})
