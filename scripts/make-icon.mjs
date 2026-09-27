// Generates the app icon procedurally (no native deps): a rounded squircle with
// the Moshi gradient and two overlapping chat bubbles. Writes build/icon.png
// (512) and resources/icon.png (256).
import { deflateSync } from 'zlib'
import { writeFileSync, mkdirSync } from 'fs'

function render(size) {
  const px = new Uint8Array(size * size * 4)
  const ss = 3 // supersampling
  const radius = size * 0.225
  const inset = size * 0.04
  const set = (x, y, r, g, b, a) => {
    const i = (y * size + x) * 4
    px[i] = r
    px[i + 1] = g
    px[i + 2] = b
    px[i + 3] = a
  }
  const inRoundRect = (x, y) => {
    const x0 = inset
    const y0 = inset
    const x1 = size - inset
    const y1 = size - inset
    if (x < x0 || x > x1 || y < y0 || y > y1) return false
    const cx = Math.min(Math.max(x, x0 + radius), x1 - radius)
    const cy = Math.min(Math.max(y, y0 + radius), y1 - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius
  }
  const bubble = (x, y, cx, cy, w, h, tailDir) => {
    const dx = (x - cx) / (w / 2)
    const dy = (y - cy) / (h / 2)
    if (dx * dx + dy * dy <= 1) return true
    // tail: small triangle at the bottom corner
    const tx = cx + tailDir * w * 0.28
    const ty = cy + h * 0.32
    const s = w * 0.2
    const lx = x - tx
    const ly = y - ty
    if (tailDir > 0) return lx >= -s * 0.2 && lx <= s && ly >= -s * 0.1 && ly <= s * 0.9 && ly <= s * 0.9 - lx * 0.7
    return lx <= s * 0.2 && lx >= -s && ly >= -s * 0.1 && ly <= s * 0.9 && ly <= s * 0.9 + lx * 0.7
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const fx = x + (sx + 0.5) / ss
          const fy = y + (sy + 0.5) / ss
          if (!inRoundRect(fx, fy)) continue
          const t = (fx + fy) / (2 * size)
          // gradient: #5AC8FA -> #007AFF -> #AF52DE
          let cr, cg, cb
          if (t < 0.55) {
            const k = t / 0.55
            cr = 0x5a + (0x00 - 0x5a) * k
            cg = 0xc8 + (0x7a - 0xc8) * k
            cb = 0xfa + (0xff - 0xfa) * k
          } else {
            const k = (t - 0.55) / 0.45
            cr = 0x00 + (0xaf - 0x00) * k
            cg = 0x7a + (0x52 - 0x7a) * k
            cb = 0xff + (0xde - 0xff) * k
          }
          const back = bubble(fx, fy, size * 0.4, size * 0.44, size * 0.5, size * 0.4, -1)
          const front = bubble(fx, fy, size * 0.6, size * 0.58, size * 0.5, size * 0.4, 1)
          if (front) {
            cr = 255
            cg = 255
            cb = 255
          } else if (back) {
            cr = cr * 0.35 + 255 * 0.65
            cg = cg * 0.35 + 255 * 0.65
            cb = cb * 0.35 + 255 * 0.65
          }
          r += cr
          g += cg
          b += cb
          a += 255
        }
      }
      const n = ss * ss
      const alpha = a / n
      if (alpha > 0) set(x, y, Math.round(r / (a / 255)), Math.round(g / (a / 255)), Math.round(b / (a / 255)), Math.round(alpha))
    }
  }
  return px
}

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function png(size, pixels) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

mkdirSync('build', { recursive: true })
mkdirSync('resources', { recursive: true })
writeFileSync('build/icon.png', png(512, render(512)))
writeFileSync('resources/icon.png', png(256, render(256)))
console.log('icons written: build/icon.png (512), resources/icon.png (256)')
