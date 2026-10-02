// The Moshi sticker edge (a white outline and a faint dark rim just outside it, as in src/shared/stickers.ts OUTLINE,
// scaled to 384 px) and the helpers both picture packs (design/mito, design/pals) build their files with.
import sharp from 'sharp'

export const SIZE = 384
// Same sticker edge as the Moshi pack (src/shared/stickers.ts OUTLINE, scaled to 384 px): a white outline and a
// faint dark rim just outside it.
export const WHITE_R = 12
export const RIM_R = 16
const RIM = [20, 20, 50, 0.14]

/** Euclidean distance (in px) from every pixel to the nearest pixel of the shape (alpha ≥ 128). */
export function distance(alpha, w, h) {
  const INF = 1e12
  const f = new Float64Array(Math.max(w, h))
  const d = new Float64Array(Math.max(w, h))
  const v = new Int32Array(Math.max(w, h))
  const z = new Float64Array(Math.max(w, h) + 1)
  const grid = new Float64Array(w * h)
  for (let i = 0; i < w * h; i++) grid[i] = alpha[i] >= 128 ? 0 : INF
  const pass = (n, get, set) => {
    for (let q = 0; q < n; q++) f[q] = get(q)
    let k = 0
    v[0] = 0; z[0] = -INF; z[1] = INF
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      while (s <= z[k]) { k--; s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]) }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF
    }
    k = 0
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]] }
    for (let q = 0; q < n; q++) set(q, d[q])
  }
  for (let x = 0; x < w; x++) pass(h, (y) => grid[y * w + x], (y, val) => { grid[y * w + x] = val })
  for (let y = 0; y < h; y++) pass(w, (x) => grid[y * w + x], (x, val) => { grid[y * w + x] = val })
  for (let i = 0; i < w * h; i++) grid[i] = Math.sqrt(grid[i])
  return grid
}

/** Puts the sticker edge around a 384 × 384 RGBA image (raw buffer) and returns a new raw buffer. */
export function outline(rgba) {
  const n = SIZE * SIZE
  const alpha = new Uint8Array(n)
  for (let i = 0; i < n; i++) alpha[i] = rgba[i * 4 + 3]
  const dist = distance(alpha, SIZE, SIZE)
  const res = Buffer.alloc(n * 4)
  for (let i = 0; i < n; i++) {
    const cover = (r) => Math.min(1, Math.max(0, r + 0.5 - dist[i]))
    // rim, then white over it, then the drawing over both ("over" compositing, straight alpha)
    let r = RIM[0], g = RIM[1], b = RIM[2], a = RIM[3] * cover(RIM_R)
    const wa = cover(WHITE_R)
    ;[r, g, b, a] = over([255, 255, 255, wa], [r, g, b, a])
    const s = [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], rgba[i * 4 + 3] / 255]
    ;[r, g, b, a] = over(s, [r, g, b, a])
    res[i * 4] = Math.round(r); res[i * 4 + 1] = Math.round(g); res[i * 4 + 2] = Math.round(b); res[i * 4 + 3] = Math.round(a * 255)
  }
  return res
}
/** One raw RGBA picture over another (lower first). */
export function stack(lower, upper) {
  const res = Buffer.alloc(SIZE * SIZE * 4)
  for (let i = 0; i < SIZE * SIZE; i++) {
    const [r, g, b, a] = over([upper[i * 4], upper[i * 4 + 1], upper[i * 4 + 2], upper[i * 4 + 3] / 255], [lower[i * 4], lower[i * 4 + 1], lower[i * 4 + 2], lower[i * 4 + 3] / 255])
    res[i * 4] = Math.round(r); res[i * 4 + 1] = Math.round(g); res[i * 4 + 2] = Math.round(b); res[i * 4 + 3] = Math.round(a * 255)
  }
  return res
}
export function over([sr, sg, sb, sa], [dr, dg, db, da]) {
  const a = sa + da * (1 - sa)
  if (a <= 0) return [0, 0, 0, 0]
  return [(sr * sa + dr * da * (1 - sa)) / a, (sg * sa + dg * da * (1 - sa)) / a, (sb * sa + db * da * (1 - sa)) / a, a]
}

/** A picture fitted into the sticker square, leaving room for the edge; returns raw RGBA. */
export async function fit(input, box) {
  const img = sharp(input).ensureAlpha()
  const trimmed = box === 'trim' ? await img.trim({ threshold: 1 }).toBuffer() : await img.toBuffer()
  const inner = SIZE - 2 * (RIM_R + 4)
  return sharp(trimmed)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: RIM_R + 4, bottom: RIM_R + 4, left: RIM_R + 4, right: RIM_R + 4, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .raw().toBuffer()
}

export const raw = (buf) => sharp(buf, { raw: { width: SIZE, height: SIZE, channels: 4 } })
