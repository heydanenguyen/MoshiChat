/**
 * The reaction burst (motion idea 3): eight small particles, four copies of the emoji and four colour specks, thrown from
 * the tap on a parabola. Pure maths (`burstKeyframes`, `burstColors`) plus one function that appends the particles to a
 * fixed layer at the document root, so no bubble or row clips them and nothing is laid out around them.
 */

export const PARTICLES = 8
export const BURST_MS = 600
/** At most one burst this often. */
export const BURST_GAP_MS = 150
const GRAVITY = 230 // px/s²
const FADE_FROM = 0.55
const STEPS = 12

export interface BurstFrame {
  offset: number
  x: number
  y: number
  rotate: number
  opacity: number
}

export interface Particle {
  /** An emoji copy (13-19 px) or a colour speck (6-9 px). */
  kind: 'emoji' | 'speck'
  size: number
  /** Which of the emoji's two colours a speck uses. */
  color: 0 | 1
  frames: BurstFrame[]
}

/** A small seeded generator (mulberry32): the same seed always throws the same burst, which makes it testable. */
function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Particle `i` of the burst for `seed`: even ones are the emoji, odd ones the specks. It leaves at -90° ± 75° (straight up,
 * fanned out) at 80-150 px/s, gravity pulls it back at 230 px/s², it turns up to ±70° and fades from 55 % of the 600 ms.
 * Positions are relative to the tap point.
 */
export function burstKeyframes(i: number, seed: number): Particle {
  const rnd = random(seed * 977 + i * 7919 + 13)
  const kind = i % 2 === 0 ? 'emoji' : 'speck'
  const angle = ((-90 + (rnd() * 2 - 1) * 75) * Math.PI) / 180
  const speed = 80 + rnd() * 70
  const spin = (rnd() * 2 - 1) * 70
  const size = kind === 'emoji' ? Math.round(13 + rnd() * 6) : Math.round(6 + rnd() * 3)
  const vx = Math.cos(angle) * speed
  const vy = Math.sin(angle) * speed
  const frames: BurstFrame[] = []
  for (let s = 0; s <= STEPS; s++) {
    const p = s / STEPS
    const t = (p * BURST_MS) / 1000
    frames.push({
      offset: p,
      x: +(vx * t).toFixed(2),
      y: +(vy * t + 0.5 * GRAVITY * t * t).toFixed(2),
      rotate: +(spin * p).toFixed(2),
      opacity: p <= FADE_FROM ? 1 : +(1 - (p - FADE_FROM) / (1 - FADE_FROM)).toFixed(3)
    })
  }
  return { kind, size, color: ((i >> 1) & 1) as 0 | 1, frames }
}

/** The two specks' colours for an emoji family (the others get the accent and its soft tint). */
export function burstColors(emoji: string): [string, string] {
  if (emoji.startsWith('❤') || emoji === '💖' || emoji === '💗') return ['#ff4d6d', '#ff9eb5']
  if (emoji === '😂' || emoji === '🤣' || emoji === '😆') return ['#ffc53d', '#ff8a3d']
  if (emoji === '👍') return ['#2f5fe0', '#7aa2ff']
  // (--accent-soft is a 13 % wash, too faint for a speck: the same hue, lightened, as a solid colour)
  return ['var(--accent)', 'color-mix(in srgb, var(--accent) 40%, white)']
}

let last = 0
let layer: HTMLDivElement | undefined

/** For tests: forget the last burst. */
export function resetBurst(): void {
  last = 0
}

/** Is a burst allowed now? (one per 150 ms) */
export function burstAllowed(now: number, previous: number): boolean {
  return now - previous >= BURST_GAP_MS
}

/** Throws the burst from the page point (x, y). Nothing under reduced motion; nothing within 150 ms of the last one. */
export function burst(x: number, y: number, emoji: string): void {
  if (typeof document === 'undefined') return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const now = performance.now()
  if (!burstAllowed(now, last)) return
  last = now
  const seed = Math.floor(Math.random() * 1e9)
  const colors = burstColors(emoji)
  if (!layer || !layer.isConnected) {
    layer = document.createElement('div')
    layer.className = 'burst-layer'
    layer.setAttribute('aria-hidden', 'true')
    document.body.appendChild(layer)
  }
  const host = layer
  let alive = PARTICLES
  for (let i = 0; i < PARTICLES; i++) {
    const p = burstKeyframes(i, seed)
    const el = document.createElement('span')
    el.className = `burst-particle ${p.kind}`
    el.style.left = `${x - p.size / 2}px`
    el.style.top = `${y - p.size / 2}px`
    if (p.kind === 'emoji') {
      el.textContent = emoji
      el.style.fontSize = `${p.size}px`
    } else {
      el.style.width = el.style.height = `${p.size}px`
      el.style.background = colors[p.color]
    }
    host.appendChild(el)
    const run = el.animate(
      p.frames.map((f) => ({ offset: f.offset, transform: `translate(${f.x}px, ${f.y}px) rotate(${f.rotate}deg)`, opacity: f.opacity })),
      { duration: BURST_MS, easing: 'linear', fill: 'forwards' }
    )
    run.onfinish = run.oncancel = () => {
      el.remove()
      if (--alive === 0 && host.childElementCount === 0) host.remove()
    }
  }
}

// Where the last tap was, so a reaction picked from a list that has no event of its own (the emoji sheet) still knows.
let pointerAt: { x: number; y: number; at: number } | undefined
let keyAt = 0
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => (pointerAt = { x: e.clientX, y: e.clientY, at: performance.now() }), true)
  document.addEventListener('keydown', () => (keyAt = performance.now()), true)
}

/** The point of the tap that led here, or undefined when it came from the keyboard (or a long time ago). */
export function lastTap(now = performance.now()): { x: number; y: number } | undefined {
  if (!pointerAt || now - pointerAt.at > 3000 || keyAt > pointerAt.at) return undefined
  return { x: pointerAt.x, y: pointerAt.y }
}
