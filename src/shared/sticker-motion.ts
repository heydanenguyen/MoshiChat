/**
 * Motion for the Moshi sticker pack. Each expression gets a short loop built on the classic animation
 * principles: anticipation before a big move, squash and stretch on the body (volume kept: when it
 * gets wider it gets shorter), overshoot and settle, follow-through on props that trail the body, and
 * eased timing everywhere (nothing moves linearly except a shiver).
 *
 * One description drives both players: CSS keyframes in the app (stickerMotionCss) and exported
 * frames for animated GIFs (stickerFrameAttrs), so a sticker moves the same here and on the other side.
 * Coordinates are the character's 64×64 canvas; the body pivots at its feet.
 */
import { stickerParts, type PartAttrs, type Pt, type StickerExpression, type StickerId, type StickerParts } from './stickers'

export type Ease = 'linear' | 'inOut' | 'in' | 'out' | 'back' | 'soft'

/** One pose at `at` (0..1 of the loop). s sets sx and sy together. */
export interface Key {
  at: number
  tx?: number
  ty?: number
  r?: number
  s?: number
  sx?: number
  sy?: number
  o?: number
  /** Timing of the move that starts here. */
  ease?: Ease
}

export interface Track {
  keys: Key[]
  /** Start this far into the loop (0..1), for staggered props. */
  phase?: number
}

export interface Motion {
  /** Seconds per loop. */
  duration: number
  body?: Track
  eyes?: Track
  mouth?: Track
  props?: Array<Track | undefined>
}

export const EASES: Record<Ease, [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  inOut: [0.45, 0, 0.55, 1],
  in: [0.55, 0, 0.85, 0.35],
  out: [0.2, 0.8, 0.35, 1],
  back: [0.34, 1.56, 0.64, 1],
  soft: [0.37, 0, 0.63, 1]
}

const rest: Key = { at: 0 }
const end: Key = { at: 1 }
/** A shiver: quick alternating offsets that die down. */
const shiver = (from: number, to: number, amp: number, steps: number, axis: 'tx' | 'r' = 'tx'): Key[] =>
  Array.from({ length: steps }, (_, i) => ({ at: from + ((to - from) * (i + 1)) / (steps + 1), [axis]: (i % 2 ? -1 : 1) * amp * (1 - i / steps), ease: 'inOut' as Ease }))
/** Sparkles swell and turn a quarter (the 4-point star looks the same at 90°), starting at `from`. */
const twinkle = (from = 0): Track => ({
  keys: [
    { ...rest, ease: 'linear' },
    { at: from, s: 1, r: 0, ease: 'inOut' },
    { at: from + 0.3, s: 1.28, r: 45, ease: 'inOut' },
    { at: from + 0.55, s: 0.82, r: 80, ease: 'soft' },
    { at: from + 0.7, s: 1, r: 90 },
    { at: 1, s: 1, r: 90 }
  ]
})
/** A drop (tear, sweat) that slides down, falls away, and wells up again in place by the end. */
const drip = (from: number, fall: number): Track => ({
  keys: [
    { ...rest, ease: 'linear' },
    { at: from, ease: 'in' },
    { at: from + 0.28, ty: fall * 0.3, sy: 1.1, ease: 'in' },
    { at: from + 0.46, ty: fall, sx: 0.85, sy: 1.25, o: 0, ease: 'linear' },
    { at: from + 0.47, s: 0, o: 0, ease: 'back' },
    { at: from + 0.62, s: 1.1, o: 1, ease: 'soft' },
    { at: from + 0.7, s: 1 },
    end
  ]
})
/** A heart that floats up and fades, then pops back in where it was. */
const floatAway = (from: number, dx: number, dy: number): Track => ({
  keys: [
    { ...rest, ease: 'linear' },
    { at: from, ease: 'soft' },
    { at: from + 0.3, tx: dx, ty: dy, s: 1.1, r: dx * 3, o: 0, ease: 'linear' },
    { at: from + 0.31, s: 0, o: 0, ease: 'back' },
    { at: from + 0.45, s: 1.12, o: 1, ease: 'soft' },
    { at: from + 0.52, s: 1 },
    end
  ]
})

// Every track starts and ends on the still pose (rest), so a sticker can start and stop on a loop
// boundary without a jump; staggering is done with different timings, not phase offsets.
export const MOTIONS: Record<StickerExpression, Motion> = {
  // Heartbeat: two beats and a rest; the heart eyes pump harder than the body, hearts float away.
  love: {
    duration: 1.8,
    body: {
      keys: [
        { ...rest, ease: 'out' },
        { at: 0.09, sx: 1.07, sy: 0.94, ease: 'back' },
        { at: 0.18, sx: 0.98, sy: 1.04, ty: -1, ease: 'out' },
        { at: 0.27, sx: 1.05, sy: 0.96, ease: 'back' },
        { at: 0.4, sx: 1, sy: 1 },
        end
      ]
    },
    eyes: {
      keys: [{ ...rest, ease: 'back' }, { at: 0.09, s: 1.28, ease: 'out' }, { at: 0.18, s: 0.94, ease: 'back' }, { at: 0.27, s: 1.2, ease: 'soft' }, { at: 0.42, s: 1 }, end]
    },
    props: [floatAway(0.3, 2, -9), floatAway(0.42, -1.5, -8)]
  },
  // Belly laugh: rocking side to side with a bounce on every swing, the mouth chattering, tears flung out.
  haha: {
    duration: 1.3,
    body: {
      keys: [
        { ...rest, ease: 'out' },
        { at: 0.12, r: -7, ty: -1.6, sx: 0.97, sy: 1.04, ease: 'inOut' },
        { at: 0.25, r: 6, ty: 0, sx: 1.04, sy: 0.96, ease: 'inOut' },
        { at: 0.38, r: -5, ty: -1.4, sx: 0.97, sy: 1.03, ease: 'inOut' },
        { at: 0.51, r: 4, ty: 0, sx: 1.03, sy: 0.97, ease: 'inOut' },
        { at: 0.64, r: -2.5, ty: -0.8, ease: 'inOut' },
        { at: 0.78, r: 0, ty: 0 },
        end
      ]
    },
    mouth: {
      keys: [
        { ...rest, ease: 'inOut' },
        { at: 0.12, sy: 1.18, ease: 'inOut' },
        { at: 0.25, sy: 0.88, ease: 'inOut' },
        { at: 0.38, sy: 1.15, ease: 'inOut' },
        { at: 0.51, sy: 0.9, ease: 'inOut' },
        { at: 0.64, sy: 1.08, ease: 'soft' },
        { at: 0.78, sy: 1 },
        end
      ]
    },
    props: [-1, 1].map((side) => ({
      keys: [
        { ...rest, ease: 'out' },
        { at: 0.14, tx: side * 2, ty: -1.2, r: side * 15, ease: 'inOut' },
        { at: 0.4, tx: side * 1, ty: 0.5, r: -side * 5, ease: 'inOut' },
        { at: 0.64, tx: side * 1.8, ty: -0.8, r: side * 10, ease: 'soft' },
        { at: 0.85, tx: 0, ty: 0, r: 0 },
        end
      ]
    }))
  },
  // Surprise: a small crouch (anticipation), then it springs up tall, eyes pop, and it settles.
  wow: {
    duration: 1.9,
    body: {
      keys: [
        { ...rest, ease: 'soft' },
        { at: 0.12, sx: 1.08, sy: 0.9, ease: 'out' },
        { at: 0.24, sx: 0.92, sy: 1.12, ty: -3.5, ease: 'in' },
        { at: 0.36, sx: 1.05, sy: 0.95, ty: 0, ease: 'out' },
        { at: 0.47, sx: 0.99, sy: 1.02, ease: 'soft' },
        { at: 0.58, sx: 1, sy: 1 },
        end
      ]
    },
    eyes: {
      keys: [{ ...rest, ease: 'in' }, { at: 0.12, sx: 1.05, sy: 0.85, ease: 'back' }, { at: 0.26, s: 1.22, ease: 'soft' }, { at: 0.45, s: 1.08, ease: 'soft' }, { at: 0.62, s: 1.12, ease: 'soft' }, { at: 0.85, s: 1 }, end]
    },
    mouth: { keys: [{ ...rest, ease: 'out' }, { at: 0.26, sx: 0.9, sy: 1.35, ease: 'soft' }, { at: 0.5, sx: 0.95, sy: 1.15, ease: 'soft' }, { at: 0.85, s: 1 }, end] },
    props: [twinkle(0.2), twinkle(0.3)]
  },
  // A slow sigh: the body sinks and widens, then a tear slides down and drops away.
  sad: {
    duration: 2.8,
    body: { keys: [{ ...rest, ease: 'inOut' }, { at: 0.35, sx: 1.025, sy: 0.955, ty: 0.8, ease: 'soft' }, { at: 0.7, sx: 1.02, sy: 0.96, ty: 0.8, ease: 'inOut' }, end] },
    eyes: { keys: [{ ...rest, ease: 'inOut' }, { at: 0.35, ty: 0.9, ease: 'soft' }, { at: 0.7, ty: 0.9, ease: 'inOut' }, end] },
    mouth: { keys: [{ ...rest, ease: 'inOut' }, { at: 0.35, sx: 0.9, ty: 0.4, ease: 'soft' }, { at: 0.7, sx: 0.92, ty: 0.4, ease: 'inOut' }, end] },
    props: [drip(0.25, 12)]
  },
  // Fuming: it winds up, shakes hard, and the anger mark throbs; then a second, smaller shake.
  angry: {
    duration: 1.5,
    body: {
      keys: [
        { ...rest, ease: 'in' },
        { at: 0.08, sx: 1.05, sy: 0.95, ease: 'linear' },
        ...shiver(0.08, 0.38, 1.4, 7),
        { at: 0.42, tx: 0, sx: 1, sy: 1, ease: 'in' },
        { at: 0.55, sx: 1.03, sy: 0.97, ease: 'linear' },
        ...shiver(0.55, 0.78, 0.9, 5),
        { at: 0.82, tx: 0, s: 1 },
        end
      ]
    },
    eyes: { keys: [{ ...rest, ease: 'out' }, { at: 0.08, sy: 0.82, ease: 'soft' }, { at: 0.42, sy: 0.9, ease: 'soft' }, { at: 0.6, sy: 0.85, ease: 'soft' }, { at: 0.85, sy: 1 }, end] },
    props: [
      {
        keys: [
          { ...rest, ease: 'back' },
          { at: 0.1, s: 1.4, ease: 'soft' },
          { at: 0.24, s: 0.9, ease: 'back' },
          { at: 0.36, s: 1.25, ease: 'soft' },
          { at: 0.5, s: 0.95, ease: 'back' },
          { at: 0.62, s: 1.15, ease: 'soft' },
          { at: 0.8, s: 1 },
          end
        ]
      }
    ]
  },
  // Too cool: a lazy nod, then the shades slide down for a peek and snap back, with a glint.
  cool: {
    duration: 2.6,
    body: { keys: [{ ...rest, ease: 'inOut' }, { at: 0.18, r: -4, ty: -0.6, ease: 'inOut' }, { at: 0.36, r: 3, ty: 0.3, ease: 'inOut' }, { at: 0.5, r: 0, ty: 0 }, end] },
    eyes: { keys: [{ ...rest, ease: 'linear' }, { at: 0.55, ease: 'in' }, { at: 0.66, ty: 2.6, ease: 'soft' }, { at: 0.8, ty: 2.6, ease: 'back' }, { at: 0.9, ty: 0 }, end] },
    mouth: { keys: [{ ...rest, ease: 'linear' }, { at: 0.58, ease: 'out' }, { at: 0.7, sx: 1.18, r: -6, ease: 'soft' }, { at: 0.88, s: 1, r: 0 }, end] },
    props: [{ keys: [{ ...rest, ease: 'linear' }, { at: 0.82, ease: 'back' }, { at: 0.9, s: 1.45, r: 45, ease: 'soft' }, { at: 1, s: 1, r: 90 }] }]
  },
  // Dozing: long slow breaths, the mouth rounding with each one, Z's drifting up one after another.
  sleepy: {
    duration: 3.4,
    body: { keys: [{ ...rest, ease: 'inOut' }, { at: 0.5, sx: 0.98, sy: 1.045, ty: -0.6, r: -1.5, ease: 'inOut' }, end] },
    mouth: { keys: [{ ...rest, ease: 'inOut' }, { at: 0.5, s: 1.3, ease: 'inOut' }, end] },
    props: [0, 0.12, 0.24].map((from) => ({
      keys: [
        { ...rest, ease: 'linear' },
        { at: from, ease: 'in' },
        { at: from + 0.32, tx: 2, ty: -3.5, s: 1.12, r: -10, o: 0, ease: 'linear' },
        { at: from + 0.33, tx: -2, ty: 3, s: 0.5, o: 0, ease: 'out' },
        { at: from + 0.62, tx: 0, ty: 0, s: 1, r: 0, o: 1 },
        end
      ]
    }))
  },
  // Wink: a quick head tilt with overshoot, a hop, and the sparkles catching the light.
  wink: {
    duration: 2,
    body: {
      keys: [
        { ...rest, ease: 'out' },
        { at: 0.08, sx: 1.04, sy: 0.96, ease: 'back' },
        { at: 0.22, r: 8, ty: -1.5, sx: 0.98, sy: 1.03, ease: 'soft' },
        { at: 0.34, r: 6, ty: 0, ease: 'soft' },
        { at: 0.62, r: 6, ease: 'back' },
        { at: 0.78, r: -1.5, ease: 'soft' },
        { at: 0.9, r: 0 },
        end
      ]
    },
    eyes: { keys: [{ ...rest, ease: 'out' }, { at: 0.1, sy: 0.88, ease: 'back' }, { at: 0.24, sy: 1.05, ease: 'soft' }, { at: 0.36, s: 1 }, end] },
    mouth: { keys: [{ ...rest, ease: 'back' }, { at: 0.2, sx: 1.12, sy: 1.1, ease: 'soft' }, { at: 0.4, s: 1 }, end] },
    props: [twinkle(0.12), twinkle(0.28)]
  },
  // Party: crouch, jump, hang, land with a squash, settle; the hat lags and wobbles, confetti bursts.
  party: {
    duration: 1.5,
    body: {
      keys: [
        { ...rest, ease: 'out' },
        { at: 0.12, sx: 1.12, sy: 0.86, ease: 'in' },
        { at: 0.28, sx: 0.91, sy: 1.1, ty: -3.5, ease: 'out' },
        { at: 0.44, sx: 0.98, sy: 1.02, ty: -4.2, ease: 'in' },
        { at: 0.58, sx: 1.12, sy: 0.87, ty: 0, ease: 'out' },
        { at: 0.7, sx: 0.97, sy: 1.03, ease: 'soft' },
        { at: 0.82, sx: 1, sy: 1 },
        end
      ]
    },
    eyes: { keys: [{ ...rest, ease: 'soft' }, { at: 0.28, s: 1.12, ease: 'soft' }, { at: 0.58, sx: 1.05, sy: 0.9, ease: 'soft' }, { at: 0.75, s: 1 }, end] },
    mouth: { keys: [{ ...rest, ease: 'soft' }, { at: 0.3, sy: 1.2, ease: 'soft' }, { at: 0.6, sy: 0.9, ease: 'soft' }, { at: 0.75, s: 1 }, end] },
    props: [
      // The hat sits on top of a squashing body: it drops with the crouch, rises with the stretch, and trails.
      {
        keys: [
          { ...rest, ease: 'out' },
          { at: 0.14, ty: 6, r: 5, ease: 'in' },
          { at: 0.3, ty: -8, r: -9, ease: 'out' },
          { at: 0.46, ty: -5.2, r: 7, ease: 'in' },
          { at: 0.6, ty: 5.5, r: 11, ease: 'out' },
          { at: 0.72, ty: -1.2, r: -6, ease: 'soft' },
          { at: 0.84, ty: 0, r: 3, ease: 'soft' },
          end
        ]
      },
      // Confetti bursts out on take-off and tumbles back (half turns: the pieces look the same at 180°).
      ...[-1, -1, 1, 1, 1].map((side, i) => ({
        keys: [
          { ...rest, ease: 'linear' as Ease },
          { at: 0.12 + i * 0.02, ease: 'out' as Ease },
          { at: 0.34 + i * 0.02, tx: side * 2.5, ty: -3, s: 1.25, r: side * 60, ease: 'soft' as Ease },
          { at: 0.66, tx: side * 3.2, ty: 1.2, s: 1.05, r: side * 130, ease: 'inOut' as Ease },
          { at: 0.9, tx: 0, ty: 0, s: 1, r: side * 180 },
          { at: 1, r: side * 180 }
        ]
      }))
    ]
  },
  // Thank you: a little bow from the feet, held, then back up with a spring; the heart pulses.
  thanks: {
    duration: 2.3,
    body: {
      keys: [
        { ...rest, ease: 'soft' },
        { at: 0.1, sy: 1.03, ty: -0.4, ease: 'inOut' },
        { at: 0.32, r: -7, sy: 0.9, sx: 1.04, ty: 1, ease: 'linear' },
        { at: 0.52, r: -7, sy: 0.9, sx: 1.04, ty: 1, ease: 'out' },
        { at: 0.68, sy: 1.04, sx: 0.98, ty: -0.5, ease: 'back' },
        { at: 0.8, s: 1, ty: 0 },
        end
      ]
    },
    props: [
      { keys: [{ ...rest, ease: 'linear' }, { at: 0.6, ease: 'back' }, { at: 0.7, s: 1.35, ease: 'soft' }, { at: 0.8, s: 0.95, ease: 'soft' }, { at: 0.9, s: 1.1, ease: 'soft' }, end] },
      twinkle(0.15),
      twinkle(0.3)
    ]
  },
  // Nervous: a fine shiver, the eyes darting away, sweat sliding down and dripping off.
  nervous: {
    duration: 1.9,
    body: {
      keys: [{ ...rest, ease: 'linear' }, ...shiver(0, 0.4, 0.75, 8), { at: 0.45, tx: 0, ease: 'soft' }, { at: 0.62, sx: 1.02, sy: 0.98, ease: 'soft' }, { at: 0.8, s: 1 }, end]
    },
    eyes: { keys: [{ ...rest, ease: 'linear' }, { at: 0.42, ease: 'out' }, { at: 0.5, tx: 2.4, ty: -0.3, ease: 'linear' }, { at: 0.7, tx: 2.4, ty: -0.3, ease: 'out' }, { at: 0.78, tx: 0, ty: 0 }, end] },
    props: [drip(0.1, 11), drip(0.28, 9)]
  },
  // Kiss: lean in, pucker (the lips push out), hearts pop off and float away.
  kiss: {
    duration: 2,
    body: {
      keys: [{ ...rest, ease: 'inOut' }, { at: 0.2, r: 4, sx: 0.96, sy: 1.04, ease: 'back' }, { at: 0.36, r: -3, sx: 1.05, sy: 0.96, ease: 'soft' }, { at: 0.52, r: 0, s: 1 }, end]
    },
    mouth: { keys: [{ ...rest, ease: 'in' }, { at: 0.2, s: 0.85, ease: 'back' }, { at: 0.34, s: 1.3, tx: 0.6, ease: 'soft' }, { at: 0.55, s: 1, tx: 0 }, end] },
    props: [floatAway(0.3, 4, -8), floatAway(0.4, 3, -7)]
  }
}

// ---------------------------------------------------------------------------------------- sampling

const BODY_FEET = 57

type Pose = { tx: number; ty: number; r: number; sx: number; sy: number; o: number }
const poseOf = (k: Key): Pose => ({ tx: k.tx ?? 0, ty: k.ty ?? 0, r: k.r ?? 0, sx: k.sx ?? k.s ?? 1, sy: k.sy ?? k.s ?? 1, o: k.o ?? 1 })

/** cubic-bezier(x1, y1, x2, y2) at progress x, the way CSS computes it. */
export function bezier([x1, y1, x2, y2]: [number, number, number, number], x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t
  let t = x
  for (let i = 0; i < 8; i++) {
    const err = sampleX(t) - x
    if (Math.abs(err) < 1e-6) break
    const d = (3 * ax * t + 2 * bx) * t + cx
    if (Math.abs(d) < 1e-6) break
    t -= err / d
  }
  if (t < 0 || t > 1 || Math.abs(sampleX(t) - x) > 1e-4) {
    let lo = 0
    let hi = 1
    t = x
    for (let i = 0; i < 30; i++) {
      if (sampleX(t) < x) lo = t
      else hi = t
      t = (lo + hi) / 2
    }
  }
  return ((ay * t + by) * t + cy) * t
}

const sortedKeys = (track: Track): Key[] => [...track.keys].sort((a, b) => a.at - b.at)

/** The pose of one track at loop position t (0..1), phase included. */
export function samplePose(track: Track, t: number): Pose {
  const keys = sortedKeys(track)
  const u = (((t + (track.phase ?? 0)) % 1) + 1) % 1
  let i = 0
  while (i < keys.length - 1 && keys[i + 1].at <= u) i++
  const a = keys[i]
  const b = keys[Math.min(i + 1, keys.length - 1)]
  if (a === b || b.at <= a.at) return poseOf(a)
  const k = bezier(EASES[a.ease ?? 'inOut'], (u - a.at) / (b.at - a.at))
  const pa = poseOf(a)
  const pb = poseOf(b)
  return {
    tx: pa.tx + (pb.tx - pa.tx) * k,
    ty: pa.ty + (pb.ty - pa.ty) * k,
    r: pa.r + (pb.r - pa.r) * k,
    sx: pa.sx + (pb.sx - pa.sx) * k,
    sy: pa.sy + (pb.sy - pa.sy) * k,
    o: pa.o + (pb.o - pa.o) * k
  }
}

type PartName = 'body' | 'eyes' | 'mouth' | `p${number}`

function origins(p: StickerParts): Record<string, Pt> {
  const o: Record<string, Pt> = { body: { x: p.anchor.cx, y: BODY_FEET }, eyes: { x: p.anchor.cx, y: p.anchor.cy }, mouth: p.mouthAt }
  p.props.forEach((prop, i) => (o[`p${i}`] = prop.at))
  return o
}

function tracks(m: Motion, p: StickerParts): Array<[PartName, Track]> {
  const list: Array<[PartName, Track]> = []
  if (m.body) list.push(['body', m.body])
  if (m.eyes) list.push(['eyes', m.eyes])
  if (m.mouth) list.push(['mouth', m.mouth])
  m.props?.forEach((track, i) => track && i < p.props.length && list.push([`p${i}`, track]))
  return list
}

const n = (v: number): string => (Math.round(v * 1000) / 1000).toString()

/** The same transform for CSS (px = user units) and for SVG attributes. */
function transformOf(o: Pt, q: Pose, css: boolean): string {
  const u = css ? 'px' : ''
  const d = css ? 'deg' : ''
  const sep = css ? ', ' : ' '
  return `translate(${n(o.x + q.tx)}${u}${sep}${n(o.y + q.ty)}${u}) rotate(${n(q.r)}${d}) scale(${n(q.sx)}${sep}${n(q.sy)}) translate(${n(-o.x)}${u}${sep}${n(-o.y)}${u})`
}

export const motionOf = (id: StickerId): Motion => MOTIONS[stickerParts(id).expression]

/** SVG attributes for every moving part at loop position t, for stickerMarkup(id, attrs). */
export function stickerFrameAttrs(id: StickerId, t: number): PartAttrs {
  const p = stickerParts(id)
  const o = origins(p)
  const attrs: PartAttrs = {}
  for (const [name, track] of tracks(MOTIONS[p.expression], p)) {
    const q = samplePose(track, t)
    attrs[name] = `transform="${transformOf(o[name], q, false)}"${q.o < 0.999 ? ` opacity="${n(Math.max(0, q.o))}"` : ''}`
  }
  return attrs
}

/**
 * Keyframes for one sticker, scoped to `.stk-<id>`, played while the <svg> has `.stk-play`.
 * Wrapped in prefers-reduced-motion so people who turned motion off get the still sticker.
 */
export function stickerMotionCss(id: StickerId): string {
  const p = stickerParts(id)
  const m = MOTIONS[p.expression]
  const o = origins(p)
  const scope = `.stk-${id}`
  let css = `${scope} .stk-part{transform-box:view-box;transform-origin:0 0}`
  for (const [name, track] of tracks(m, p)) {
    const anim = `stk-${id}-${name}`
    const hasOpacity = track.keys.some((k) => k.o !== undefined)
    const frames = sortedKeys(track)
      .map((k) => {
        const q = poseOf(k)
        const [x1, y1, x2, y2] = EASES[k.ease ?? 'inOut']
        return `${n(k.at * 100)}%{transform:${transformOf(o[name], q, true)};${hasOpacity ? `opacity:${n(q.o)};` : ''}animation-timing-function:cubic-bezier(${x1},${y1},${x2},${y2})}`
      })
      .join('')
    const delay = track.phase ? `;animation-delay:${n(-track.phase * m.duration)}s` : ''
    css += `@keyframes ${anim}{${frames}}${scope}.stk-play .stk-${name}{animation:${anim} ${m.duration}s infinite${delay}}`
  }
  return `@media (prefers-reduced-motion: no-preference){${css}}`
}
