/**
 * The celebration pack (motion idea 21): confetti with real physics, hearts drifting up, and the sticker's gloss and sparkles.
 * One canvas layer per chat column, DPR-aware; the rAF loop runs only while particles are alive (2.5 s at most for confetti,
 * 2.8 s for hearts) and the canvas is dropped by its owner when `onEnd` fires. The maths is pure and tested; the drawing and
 * the loop are at the bottom. Values are the demo's (design/proposals/2026-10-13-motion-ideas.html, card 21).
 */

export type CelebrationKind = 'confetti' | 'hearts'

export const CONFETTI_COUNT = 60
export const CONFETTI_MAX = 2.5
export const HEART_COUNT = 14
export const HEARTS_MAX = 2.8
export const GRAVITY = 900 // px/s²
export const DRAG = 1.9 // velocity × exp(-DRAG·dt)
export const FADE_S = 0.5
export const HEART_COLORS = ['#ff4d6d', '#ff8fc7']
/** The longest a frame may count for (a stalled tab must not throw the pieces across the screen). */
export const MAX_DT = 0.034

/** Accent first, then the five fixed colours. */
export function confettiColors(accent: string): string[] {
  return [accent, '#ff5b1f', '#ff8fc7', '#ffc53d', '#1fa35a', '#8a6bff']
}

/** A seeded generator (mulberry32): the same seed, the same shower. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seedOf(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export interface Piece {
  k: 'c' | 'h'
  x: number
  y: number
  vx: number
  vy: number
  /** rotation, its speed; flip phase, its speed (confetti) */
  r: number
  vr: number
  f: number
  fv: number
  /** size (confetti), sway phase and scale (hearts) */
  w: number
  h: number
  ph: number
  s: number
  color: string
  /** Seconds lived; negative = waiting to start. */
  age: number
  max: number
}

const between = (rnd: () => number, a: number, b: number): number => a + rnd() * (b - a)

/** 60 pieces thrown up from the bottom middle (two thirds down), falling under gravity and drag, spinning and flipping. */
export function makeConfetti(rnd: () => number, width: number, height: number, colors: string[]): Piece[] {
  return Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
    k: 'c' as const,
    x: width / 2 + between(rnd, -24, 24),
    y: height * 0.66,
    vx: between(rnd, -340, 340),
    vy: -between(rnd, 420, 820),
    r: between(rnd, 0, 6.28),
    vr: between(rnd, -12, 12),
    w: between(rnd, 6, 11),
    h: between(rnd, 3, 6),
    f: between(rnd, 0, 6.28),
    fv: between(rnd, 6, 14),
    ph: 0,
    s: 1,
    color: colors[i % colors.length],
    age: 0,
    max: CONFETTI_MAX
  }))
}

/** How much faster hearts rise in a tall column: the demo's 80-150 px/s would carry them a third of the way up an 800 px one. */
export function riseScale(height: number): number {
  return Math.min(2.4, Math.max(1, height / 380))
}

/** 14 hearts starting just under the bottom edge, 70 ms apart, each gone 2.8 s after the shower began. */
export function makeHearts(rnd: () => number, width: number, height: number): Piece[] {
  const up = riseScale(height)
  return Array.from({ length: HEART_COUNT }, (_, i) => {
    const delay = i * 0.07
    return {
      k: 'h' as const,
      x: between(rnd, 30, Math.max(31, width - 30)),
      y: height + between(rnd, 0, 30),
      vx: 0,
      vy: -between(rnd, 80, 150) * up,
      r: 0,
      vr: 0,
      f: 0,
      fv: 0,
      w: 0,
      h: 0,
      ph: between(rnd, 0, 6.28),
      s: between(rnd, 0.8, 1.5),
      color: HEART_COLORS[i % 3 ? 0 : 1],
      age: -delay,
      max: HEARTS_MAX - delay
    }
  })
}

/** Advance one piece by `dt` seconds. False when it is finished. */
export function stepPiece(p: Piece, dt: number): boolean {
  p.age += dt
  if (p.age >= p.max) return false
  if (p.age < 0) return true
  if (p.k === 'c') {
    p.vy += GRAVITY * dt
    const drag = Math.exp(-DRAG * dt)
    p.vx *= drag
    p.vy *= drag
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.r += p.vr * dt
    p.f += p.fv * dt
  } else {
    p.y += p.vy * dt
  }
  return true
}

/** Opacity: full, then fading over the last half second. */
export function fadeOf(p: Piece): number {
  return Math.min(1, Math.max(0, (p.max - p.age) / FADE_S))
}

/** A heart's x with its sway, rotation and scale (it grows in over its first .6 s). */
export function heartPose(p: Piece): { x: number; rotate: number; scale: number } {
  return { x: p.x + Math.sin(p.age * 1.7 + p.ph) * 20, rotate: Math.sin(p.age * 2.1 + p.ph) * 0.45, scale: (0.55 + Math.min(1, p.age / 0.6) * 0.45) * p.s }
}

/** One frame: advance every piece, keep the living. */
export function stepAll(parts: Piece[], dt: number): Piece[] {
  return parts.filter((p) => stepPiece(p, Math.min(MAX_DT, dt)))
}

/** How long a kind of shower lasts at the most (s). */
export const durationOf = (kind: CelebrationKind): number => (kind === 'hearts' ? HEARTS_MAX : CONFETTI_MAX)

// ---------------------------------------------------------------- the sticker's gloss and sparkles

export const SHINE = {
  /** The gloss sweeps 520 ms after the landing and takes 560 ms. */
  glossDelay: 520,
  glossMs: 560,
  /** Three sparkles, scale 0 → 1.15 → 0 in 520 ms, 110 ms apart (the first at 640 ms, as in the demo). */
  sparkStart: 640,
  sparkStagger: 110,
  sparkMs: 520,
  sparks: 3
}

/** The delay (ms) of the gloss (index -1) or sparkle `i`, less what has already passed (a negative delay carries on mid-way). */
export function shineDelay(index: number, elapsedMs = 0): number {
  const base = index < 0 ? SHINE.glossDelay : SHINE.sparkStart + index * SHINE.sparkStagger
  return base - Math.min(Math.max(0, elapsedMs), 1500)
}

/** When everything has finished (ms after landing). */
export const shineEnd = (): number => SHINE.sparkStart + (SHINE.sparks - 1) * SHINE.sparkStagger + SHINE.sparkMs

// ---------------------------------------------------------------- drawing and the loop (needs a canvas)

let heartPath: Path2D | undefined

/** `color` ("var(--accent)", "#2f5fe0") as something a canvas accepts. */
export function resolveColor(color: string, host: Element = document.documentElement): string {
  const probe = document.createElement('span')
  probe.style.color = color
  host.appendChild(probe)
  const out = getComputedStyle(probe).color
  probe.remove()
  return out || '#2f5fe0'
}

function drawPiece(ctx: CanvasRenderingContext2D, p: Piece): void {
  if (p.age < 0) return
  ctx.save()
  ctx.globalAlpha = fadeOf(p)
  ctx.fillStyle = p.color
  if (p.k === 'c') {
    ctx.translate(p.x, p.y)
    ctx.rotate(p.r)
    ctx.scale(1, Math.cos(p.f))
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
  } else {
    heartPath ??= new Path2D('M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11z')
    const pose = heartPose(p)
    ctx.translate(pose.x, p.y)
    ctx.rotate(pose.rotate)
    ctx.scale(pose.scale, pose.scale)
    ctx.translate(-12, -12)
    ctx.fill(heartPath)
  }
  ctx.restore()
}

/** Size the canvas to its box at the device's pixel ratio (at most 2); the context then draws in CSS px. */
function fit(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; width: number; height: number; dpr: number } | undefined {
  const rect = canvas.getBoundingClientRect()
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const ctx = canvas.getContext('2d')
  if (!ctx || rect.width < 1 || rect.height < 1) return undefined
  if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round(rect.height * dpr)
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { ctx, width: rect.width, height: rect.height, dpr }
}

export interface Shower {
  /** Particles drawn so far this frame (for tests and the proof). */
  count(): number
  stop(): void
}

/** Run a shower on `canvas`. `onEnd` fires once when the last piece is gone (not after `stop`). rAF runs only while pieces live. */
export function startShower(canvas: HTMLCanvasElement, kind: CelebrationKind, opts: { seed: string; accent: string; onEnd(): void }): Shower {
  const area = fit(canvas)
  if (!area) {
    queueMicrotask(opts.onEnd)
    return { count: () => 0, stop: () => undefined }
  }
  const { ctx, width, height } = area
  const rnd = seededRandom(seedOf(opts.seed))
  let parts = kind === 'hearts' ? makeHearts(rnd, width, height) : makeConfetti(rnd, width, height, confettiColors(opts.accent))
  let raf = 0
  let last = performance.now()
  let ended = false
  // `stop` (the layer left early) says nothing; only a shower that ran its course calls onEnd.
  const stop = (): void => {
    if (ended) return
    ended = true
    cancelAnimationFrame(raf)
    ctx.clearRect(0, 0, width, height)
  }
  const finish = (): void => {
    if (ended) return
    stop()
    opts.onEnd()
  }
  const tick = (ts: number): void => {
    const dt = Math.max(0, (ts - last) / 1000) || 0.016
    last = ts
    ctx.clearRect(0, 0, width, height)
    parts = stepAll(parts, dt)
    for (const p of parts) drawPiece(ctx, p)
    if (parts.length) raf = requestAnimationFrame(tick)
    else finish()
  }
  raf = requestAnimationFrame(tick)
  return { count: () => parts.length, stop }
}

/** Reduced motion: one still bundle, drawn once. The caller fades the canvas in and out. */
export function drawStatic(canvas: HTMLCanvasElement, kind: CelebrationKind, opts: { seed: string; accent: string }): void {
  const area = fit(canvas)
  if (!area) return
  const { ctx, width, height } = area
  const rnd = seededRandom(seedOf(opts.seed))
  ctx.clearRect(0, 0, width, height)
  if (kind === 'hearts') {
    for (const p of makeHearts(rnd, width, height)) {
      p.age = 1
      p.max = 10
      p.y = height * (0.25 + rnd() * 0.6)
      drawPiece(ctx, p)
    }
    return
  }
  const colors = confettiColors(opts.accent)
  for (let i = 0; i < CONFETTI_COUNT; i++) {
    ctx.fillStyle = colors[i % colors.length]
    ctx.save()
    ctx.translate(rnd() * width, rnd() * height)
    ctx.rotate(rnd() * 6)
    ctx.fillRect(-4, -2, 8, 4)
    ctx.restore()
  }
}
