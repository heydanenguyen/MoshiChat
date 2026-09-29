/**
 * The photo editor's document: the original image plus vector marks drawn over it (arrows, boxes,
 * highlights, text, numbered callouts, pixelated areas) and an optional crop. Everything is kept in
 * image pixels, so the export is sharp at the original size and undo is just an older copy.
 */

export type Tool = 'select' | 'arrow' | 'rect' | 'ellipse' | 'pen' | 'highlight' | 'text' | 'number' | 'blur' | 'crop'
export type Pt = { x: number; y: number }
export type Rect = { x: number; y: number; w: number; h: number }
/** Stroke size steps: small, medium, large. */
export type Size = 0 | 1 | 2

type Base = { id: number; color: string; size: Size }
export type Shape =
  | (Base & { kind: 'arrow' | 'rect' | 'ellipse' | 'blur'; a: Pt; b: Pt })
  | (Base & { kind: 'pen' | 'highlight'; points: Pt[] })
  | (Base & { kind: 'text'; at: Pt; text: string })
  | (Base & { kind: 'number'; at: Pt; n: number })

export interface Doc {
  shapes: Shape[]
  crop?: Rect
}

export const COLORS = ['#FF3B30', '#FF9500', '#FFD60A', '#30D158', '#0A84FF', '#BF5AF2', '#1C1C1E', '#FFFFFF'] as const

/** One "unit" scales every mark to the photo, so a 4K screenshot and a phone photo both get readable strokes. */
export function unitFor(width: number, height: number): number {
  return Math.max(1.5, Math.min(width, height) / 320)
}

const STROKE = [1.4, 2.4, 4] as const
export const strokeWidth = (unit: number, size: Size): number => unit * STROKE[size]
export const fontSize = (unit: number, size: Size): number => unit * [7, 10, 15][size]
export const numberRadius = (unit: number, size: Size): number => unit * [6, 8.5, 12][size]
const highlightWidth = (unit: number, size: Size): number => unit * [6, 10, 16][size]

export function normRect(a: Pt, b: Pt): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
}

export function clampRect(r: Rect, width: number, height: number): Rect {
  const x = Math.max(0, Math.min(r.x, width))
  const y = Math.max(0, Math.min(r.y, height))
  return { x, y, w: Math.max(0, Math.min(r.x + r.w, width) - x), h: Math.max(0, Math.min(r.y + r.h, height) - y) }
}

/** Shift while dragging: lines snap to 45°, boxes become squares. */
export function constrain(kind: Shape['kind'], a: Pt, b: Pt): Pt {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (kind === 'arrow' || kind === 'highlight' || kind === 'pen') {
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
    const len = Math.hypot(dx, dy)
    return { x: a.x + Math.cos(angle) * len, y: a.y + Math.sin(angle) * len }
  }
  const side = Math.max(Math.abs(dx), Math.abs(dy))
  return { x: a.x + Math.sign(dx || 1) * side, y: a.y + Math.sign(dy || 1) * side }
}

export type Measure = (text: string, px: number) => number

export const textLines = (text: string): string[] => text.split('\n')
const LINE = 1.25

export function bbox(shape: Shape, unit: number, measure: Measure): Rect {
  switch (shape.kind) {
    case 'arrow':
    case 'rect':
    case 'ellipse':
    case 'blur': {
      const r = normRect(shape.a, shape.b)
      const pad = shape.kind === 'blur' ? 0 : strokeWidth(unit, shape.size) * (shape.kind === 'arrow' ? 2.5 : 0.5)
      return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 }
    }
    case 'pen':
    case 'highlight': {
      const xs = shape.points.map((p) => p.x)
      const ys = shape.points.map((p) => p.y)
      const pad = (shape.kind === 'highlight' ? highlightWidth(unit, shape.size) : strokeWidth(unit, shape.size)) / 2
      const x = Math.min(...xs) - pad
      const y = Math.min(...ys) - pad
      return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y }
    }
    case 'text': {
      const px = fontSize(unit, shape.size)
      const lines = textLines(shape.text)
      const w = Math.max(...lines.map((l) => measure(l, px)), px * 0.5)
      return { x: shape.at.x, y: shape.at.y, w, h: lines.length * px * LINE }
    }
    case 'number': {
      const r = numberRadius(unit, shape.size)
      return { x: shape.at.x - r, y: shape.at.y - r, w: r * 2, h: r * 2 }
    }
  }
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

const inside = (p: Pt, r: Rect, pad = 0): boolean => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad

/** The topmost mark under a point (lines by distance, so a long diagonal arrow does not catch the whole photo). */
export function hitTest(shapes: Shape[], p: Pt, unit: number, measure: Measure, tolerance: number): Shape | undefined {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i]
    if (s.kind === 'arrow') {
      if (distToSegment(p, s.a, s.b) <= strokeWidth(unit, s.size) * 2 + tolerance) return s
    } else if (s.kind === 'pen' || s.kind === 'highlight') {
      const reach = (s.kind === 'highlight' ? highlightWidth(unit, s.size) : strokeWidth(unit, s.size)) / 2 + tolerance
      const pts = s.points
      if (pts.length === 1 ? Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= reach : pts.some((q, j) => j > 0 && distToSegment(p, pts[j - 1], q) <= reach)) return s
    } else if (inside(p, bbox(s, unit, measure), tolerance)) return s
  }
  return undefined
}

export function translate(shape: Shape, dx: number, dy: number): Shape {
  const move = (p: Pt): Pt => ({ x: p.x + dx, y: p.y + dy })
  switch (shape.kind) {
    case 'arrow':
    case 'rect':
    case 'ellipse':
    case 'blur':
      return { ...shape, a: move(shape.a), b: move(shape.b) }
    case 'pen':
    case 'highlight':
      return { ...shape, points: shape.points.map(move) }
    case 'text':
    case 'number':
      return { ...shape, at: move(shape.at) }
  }
}

export const nextNumber = (shapes: Shape[]): number => shapes.reduce((n, s) => (s.kind === 'number' ? Math.max(n, s.n) : n), 0) + 1

/** Too small to keep (a click instead of a drag). */
export function isEmpty(shape: Shape, unit: number): boolean {
  switch (shape.kind) {
    case 'text':
      return !shape.text.trim()
    case 'number':
      return false
    case 'pen':
    case 'highlight': {
      const r = bbox(shape, 0, () => 0)
      return r.w < unit && r.h < unit
    }
    case 'arrow': {
      const r = normRect(shape.a, shape.b)
      return Math.hypot(r.w, r.h) < unit * 4
    }
    default: {
      const r = normRect(shape.a, shape.b)
      return r.w < unit * 2 || r.h < unit * 2
    }
  }
}

// ---------------------------------------------------------------------------------------------- drawing

export const FONT = (px: number): string => `700 ${px}px -apple-system, "SF Pro Text", "Segoe UI", "Plus Jakarta Sans", sans-serif`

/** Dark outline for light colours and a light one for dark colours, so marks read on any photo. */
function outlineFor(color: string): string {
  const hex = color.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.9)'
}

function smoothPath(ctx: CanvasRenderingContext2D, pts: Pt[]): void {
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  if (pts.length === 1) ctx.lineTo(pts[0].x + 0.01, pts[0].y)
  for (let i = 1; i < pts.length - 1; i++) {
    const mid = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 }
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mid.x, mid.y)
  }
  if (pts.length > 1) ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y)
}

function drawArrow(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, width: number, color: string): void {
  const angle = Math.atan2(b.y - a.y, b.x - a.x)
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  const head = Math.min(len * 0.6, width * 4.2)
  const base = { x: b.x - Math.cos(angle) * head * 0.8, y: b.y - Math.sin(angle) * head * 0.8 }
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(base.x, base.y)
  ctx.stroke()
  const spread = Math.PI / 7
  ctx.beginPath()
  ctx.moveTo(b.x, b.y)
  ctx.lineTo(b.x - Math.cos(angle - spread) * head, b.y - Math.sin(angle - spread) * head)
  ctx.lineTo(b.x - Math.cos(angle + spread) * head, b.y - Math.sin(angle + spread) * head)
  ctx.closePath()
  ctx.lineJoin = 'round'
  ctx.lineWidth = width * 0.6
  ctx.fill()
  ctx.stroke()
}

/** Pixelate what is already drawn inside `r` (the photo and any marks under it), for hiding names and numbers. */
function pixelate(ctx: CanvasRenderingContext2D, r: Rect, view: Rect, unit: number): void {
  const x = Math.round(r.x - view.x)
  const y = Math.round(r.y - view.y)
  const w = Math.round(r.w)
  const h = Math.round(r.h)
  if (w < 1 || h < 1) return
  const block = Math.max(6, Math.round(unit * 5))
  const small = document.createElement('canvas')
  small.width = Math.max(1, Math.ceil(w / block))
  small.height = Math.max(1, Math.ceil(h / block))
  const sctx = small.getContext('2d')
  if (!sctx) return
  sctx.imageSmoothingEnabled = true
  sctx.drawImage(ctx.canvas, x, y, w, h, 0, 0, small.width, small.height)
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(small, 0, 0, small.width, small.height, x, y, w, h)
  ctx.restore()
}

export function drawShape(ctx: CanvasRenderingContext2D, s: Shape, unit: number, view: Rect): void {
  ctx.save()
  const width = strokeWidth(unit, s.size)
  const shadow = (): void => {
    ctx.shadowColor = 'rgba(0,0,0,0.28)'
    ctx.shadowBlur = width * 1.6
    ctx.shadowOffsetY = width * 0.35
  }
  switch (s.kind) {
    case 'arrow':
      shadow()
      drawArrow(ctx, s.a, s.b, width, s.color)
      break
    case 'rect': {
      shadow()
      const r = normRect(s.a, s.b)
      ctx.strokeStyle = s.color
      ctx.lineWidth = width
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.roundRect(r.x, r.y, r.w, r.h, Math.min(width * 2, r.w / 2, r.h / 2))
      ctx.stroke()
      break
    }
    case 'ellipse': {
      shadow()
      const r = normRect(s.a, s.b)
      ctx.strokeStyle = s.color
      ctx.lineWidth = width
      ctx.beginPath()
      ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2)
      ctx.stroke()
      break
    }
    case 'pen':
      shadow()
      ctx.strokeStyle = s.color
      ctx.lineWidth = width
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      smoothPath(ctx, s.points)
      ctx.stroke()
      break
    case 'highlight':
      ctx.globalCompositeOperation = 'multiply'
      ctx.globalAlpha = 0.42
      ctx.strokeStyle = s.color === '#FFFFFF' ? '#FFD60A' : s.color
      ctx.lineWidth = highlightWidth(unit, s.size)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      smoothPath(ctx, s.points)
      ctx.stroke()
      break
    case 'text': {
      const px = fontSize(unit, s.size)
      ctx.font = FONT(px)
      ctx.textBaseline = 'top'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = outlineFor(s.color)
      ctx.lineWidth = px * 0.2
      ctx.fillStyle = s.color
      textLines(s.text).forEach((line, i) => {
        const y = s.at.y + i * px * LINE + px * 0.1
        ctx.strokeText(line, s.at.x, y)
        ctx.fillText(line, s.at.x, y)
      })
      break
    }
    case 'number': {
      const r = numberRadius(unit, s.size)
      shadow()
      ctx.fillStyle = s.color
      ctx.beginPath()
      ctx.arc(s.at.x, s.at.y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.lineWidth = Math.max(1.5, r * 0.14)
      ctx.strokeStyle = '#fff'
      ctx.stroke()
      ctx.fillStyle = outlineFor(s.color) === 'rgba(0,0,0,0.55)' ? '#1C1C1E' : '#fff'
      ctx.font = FONT(r * (s.n > 9 ? 0.95 : 1.15))
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(s.n), s.at.x, s.at.y + r * 0.06)
      break
    }
    case 'blur':
      pixelate(ctx, normRect(s.a, s.b), view, unit)
      break
  }
  ctx.restore()
}

/** Photo + marks for the part of the image in `view`, onto a canvas the size of `view`. */
export function paint(ctx: CanvasRenderingContext2D, image: CanvasImageSource, shapes: Shape[], view: Rect, unit: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.setTransform(1, 0, 0, 1, -view.x, -view.y)
  ctx.drawImage(image, 0, 0)
  for (const s of shapes) drawShape(ctx, s, unit, view)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}
