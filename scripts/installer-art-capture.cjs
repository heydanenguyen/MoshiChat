// Electron helper for make-installer-art.mjs: renders each HTML page offscreen at 1x and saves PNG + 24-bit BMP.
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('fs')

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.disableHardwareAcceleration()
// Windows are rendered one at a time; closing one must not quit the app.
app.on('window-all-closed', () => {})

/** BGRA pixels (Electron's toBitmap) -> bottom-up 24-bit BMP. */
function toBmp(bgra, width, height) {
  const rowSize = Math.ceil((width * 3) / 4) * 4
  const data = Buffer.alloc(rowSize * height)
  for (let y = 0; y < height; y++) {
    const src = y * width * 4
    const dst = (height - 1 - y) * rowSize
    for (let x = 0; x < width; x++) {
      data[dst + x * 3] = bgra[src + x * 4]
      data[dst + x * 3 + 1] = bgra[src + x * 4 + 1]
      data[dst + x * 3 + 2] = bgra[src + x * 4 + 2]
    }
  }
  const header = Buffer.alloc(54)
  header.write('BM', 0)
  header.writeUInt32LE(54 + data.length, 2)
  header.writeUInt32LE(54, 10)
  header.writeUInt32LE(40, 14)
  header.writeInt32LE(width, 18)
  header.writeInt32LE(height, 22)
  header.writeUInt16LE(1, 26)
  header.writeUInt16LE(24, 28)
  header.writeUInt32LE(data.length, 34)
  header.writeInt32LE(2835, 38)
  header.writeInt32LE(2835, 42)
  return Buffer.concat([header, data])
}

app.whenReady().then(async () => {
  try {
    const jobs = JSON.parse(readFileSync(process.argv[process.argv.length - 1], 'utf8'))
    for (const job of jobs) {
      const win = new BrowserWindow({
        show: false,
        width: job.width,
        height: job.height,
        useContentSize: true,
        frame: false,
        webPreferences: { offscreen: true }
      })
      await win.loadFile(job.html)
      await win.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))')
      const image = await win.webContents.capturePage({ x: 0, y: 0, width: job.width, height: job.height })
      const size = image.getSize()
      const fitted = size.width === job.width && size.height === job.height ? image : image.resize({ width: job.width, height: job.height, quality: 'best' })
      writeFileSync(job.png, fitted.toPNG())
      writeFileSync(job.bmp, toBmp(fitted.toBitmap(), job.width, job.height))
      console.log(`installer art: ${job.bmp} (${size.width}x${size.height})`)
      win.destroy()
    }
  } catch (err) {
    console.error('installer art failed:', err)
    app.exit(1)
    return
  }
  app.quit()
})
