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

describe('the image proxy', () => {
  it('fetches platform CDNs, and only static pictures from the sites themselves', async () => {
    const { proxyAllowed } = await import('../src/main/safety')
    const { IMAGE_HOSTS } = await import('../src/shared/media')
    const ok = (u: string): boolean => proxyAllowed(new URL(u), IMAGE_HOSTS)
    expect(ok('https://scontent.xx.fbcdn.net/v/t39/abc.jpg?stp=x')).toBe(true)
    expect(ok('https://scontent-hkg4-1.cdninstagram.com/v/t51/123_n.jpg')).toBe(true)
    expect(ok('https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=1')).toBe(true)
    expect(ok('https://www.facebook.com/images/emoji.php/v9/t51/1/16/1f600.png')).toBe(true)
    expect(ok('https://static.xx.fbcdn.net/rsrc.php/v3/y4/r/abc.png')).toBe(true)
    expect(ok('https://www.instagram.com/static/images/ico/favicon.png/abc.png')).toBe(true)
    expect(ok('https://www.facebook.com/logout.php?h=abc')).toBe(false)
    expect(ok('https://www.facebook.com/settings')).toBe(false)
    expect(ok('https://www.instagram.com/accounts/edit/')).toBe(false)
    expect(ok('http://scontent.xx.fbcdn.net/a.jpg')).toBe(false)
    expect(ok('https://evil.example/a.png')).toBe(false)
  })
})

describe('what the app window may navigate to', () => {
  const file = pathToFileURL(join(process.cwd(), 'out', 'renderer', 'index.html')).href

  it('stays on the app page: a dropped file or a link never replaces it (file: URLs all have the origin "null")', async () => {
    const { isAppNavigation } = await import('../src/main/safety')
    expect(isAppNavigation(file, file)).toBe(true)
    expect(isAppNavigation(file + '#/inbox', file)).toBe(true)
    expect(isAppNavigation(file + '.evil.html', file)).toBe(false)
    expect(isAppNavigation(pathToFileURL(join(process.cwd(), 'secret.html')).href, file)).toBe(false)
    expect(isAppNavigation('file:///C:/Windows/System32/calc.exe', file)).toBe(false)
    expect(isAppNavigation('https://evil.example/', file)).toBe(false)
    expect(isAppNavigation('not a url', file)).toBe(false)
  })

  it('in development the dev server origin is the app, and only that origin', async () => {
    const { isAppNavigation } = await import('../src/main/safety')
    const dev = 'http://localhost:5173'
    expect(isAppNavigation('http://localhost:5173/', dev)).toBe(true)
    expect(isAppNavigation('http://localhost:5173/#x', dev)).toBe(true)
    expect(isAppNavigation('http://localhost:51730/', dev)).toBe(false)
    expect(isAppNavigation('http://localhost:5173.evil.example/', dev)).toBe(false)
  })
})

describe('attachments that would run', () => {
  it('are shown in their folder instead of opened', async () => {
    const { isExecutableName } = await import('../src/main/safety')
    for (const name of ['setup.exe', 'a.BAT', 'x.cmd', 'y.scr', 'z.msi', 'link.lnk', 'a.js', 'a.vbs', 'a.ps1', 'a.reg', 'a.jar', 'Mac.app', 'a.dmg', 'a.pkg', 'run.sh', 'photo.jpg.exe', 'a.exe ']) {
      expect(isExecutableName(name), name).toBe(true)
    }
    for (const name of ['photo.jpg', 'notes.txt', 'report.pdf', 'archive.zip', 'voice.ogg', 'noext', 'exe', '.hidden', 'a.exe.txt', 'script.json']) {
      expect(isExecutableName(name), name).toBe(false)
    }
  })
})
