// The motion of the twelve Pals stickers. Each sticker is a pal (from src/shared/pals-art.ts) with an expression and a
// function of the loop's phase p (0 → 1) that poses it: how the whole pal moves, what its parts do, and the little
// things around it (hearts, z's, tears, sparkles).
//
// Rules that keep the loops smooth:
// - every movement is periodic in p with whole cycles, or an envelope that is still (zero speed) at both ends, so the
//   last frame flows into the first with no jump;
// - p = 0 is the rest pose: it is also the still picture (picker, previews, platforms that cannot animate);
// - squash and stretch keep the volume (sx ≈ 1 / sy) and pivot on the pal's foot, so it never slides;
// - anticipation before a big move, overshoot and a damped settle after it.
import { CAST, FACE, INK, heart, palParts, specOf, stroke } from '../../src/shared/pals-art.ts'
import { PALS_STICKERS as LIST } from '../../src/shared/pals-stickers.ts'

const TAU = Math.PI * 2
const clamp01 = (x) => Math.min(1, Math.max(0, x))
const seg = (p, a, b) => clamp01((p - a) / (b - a))
/** Smootherstep: 0 → 1 with zero speed and zero acceleration at both ends. */
const ease = (x) => x * x * x * (x * (x * 6 - 15) + 10)
/** 0 → 1 → 0 over [a, b], still at both ends. */
const bump = (p, a, b) => (p <= a || p >= b ? 0 : Math.sin(Math.PI * seg(p, a, b)) ** 2)
const wave = (p, cycles = 1, phase = 0) => Math.sin(TAU * (cycles * p + phase))
/** A damped spring set off at p = a, faded to rest before the loop ends so it joins up. */
const settle = (p, a, freq, decay, end = 0.97) => (p <= a ? 0 : Math.exp(-decay * (p - a)) * Math.sin(TAU * freq * (p - a)) * (1 - ease(seg(p, end - 0.12, end))))
const gauss = (p, c, w) => Math.exp(-(((p - c) / w) ** 2))
const n = (v) => +v.toFixed(3)

/** translate/scale/rotate about a pivot, as an SVG transform. */
const about = (x, y, { sx = 1, sy = 1, rot = 0, tx = 0, ty = 0, skew = 0 } = {}) =>
  `translate(${n(x + tx)} ${n(y + ty)})${rot ? ` rotate(${n(rot)})` : ''}${skew ? ` skewX(${n(skew)})` : ''} scale(${n(sx)} ${n(sy)}) translate(${-x} ${-y})`

/** Volume-keeping squash: s > 0 stretches up, s < 0 squashes down. */
const squash = (s) => ({ sy: 1 + s, sx: 1 / Math.sqrt(1 + s) })

const PINK = '#ff4f7b'
/** A tear (or a drop) centred on its round end at 0,0, pointing up. */
const drop = (fill = '#4aa8ff') => `<path d="M0-8s-5 6.5-5 10a5 5 0 0 0 10 0c0-3.5-5-10-5-10z" fill="${fill}"/><circle cx="-1.6" cy="3" r="1.3" fill="#fff" opacity=".85"/>`
/** A four-point sparkle with an ink edge, centred on 0,0. */
const SPARKLE = `<path d="M0-8q1.4 6.6 8 8-6.6 1.4-8 8-1.4-6.6-8-8 6.6-1.4 8-8z" fill="#fff4a8" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>`
const Z = `<path d="M-5-5h10l-10 10h10" fill="none" stroke="${INK}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`
/** Floating thing: rises, sways, fades in and out (q is its own 0 → 1 life). */
const float = (q, { x, y, rise, sway = 4, from = 0.4, to = 1, svg, rot = 0 }) => {
  if (q <= 0 || q >= 1) return ''
  const o = ease(seg(q, 0, 0.18)) * (1 - ease(seg(q, 0.7, 1)))
  const s = from + (to - from) * ease(seg(q, 0, 0.5))
  return `<g transform="translate(${n(x + sway * Math.sin(TAU * q * 1.2))} ${n(y - rise * q)}) rotate(${n(rot * Math.sin(TAU * q))}) scale(${n(s)})" opacity="${n(o)}">${svg}</g>`
}

const member = (id) => CAST.find((c) => c.id === id)

/**
 * The pose of each sticker at phase p (the list itself, with names and loop lengths, is src/shared/pals-stickers.ts).
 * A pose may set: root (whole pal), behind / body / over / face (extra transform for that part, in artboard units),
 * eyes / mouth (extra transform or replacement markup, in the face's canonical units), back / front (things drawn
 * behind / in front of the pal, in artboard units), bodyMarkup (a replacement body shape).
 */
const POSES = [
  {
    // Hoa waves hello: a friendly side-to-side lean, petals turning, a blink.
    id: 'chao',
    pose: (p) => ({
      root: about(60, 114, { rot: 6 * wave(p), ...squash(0.025 * wave(p, 2)) }),
      body: about(60, 62, { rot: 60 * ease(p) }),
      face: about(60, 64, { tx: 1.6 * wave(p) }),
      eyes: about(60, 58, { sy: 1 - 0.92 * bump(p, 0.6, 0.7) })
    })
  },
  {
    // Trứng bounces with joy in its pan: a crouch, a big hop, a small one, a jelly settle; the eyes twinkle.
    id: 'vui',
    pose: (p) => {
      const hop1 = bump(p, 0.14, 0.42)
      const hop2 = bump(p, 0.5, 0.66)
      const lift = 13 * Math.sin(Math.PI * seg(p, 0.14, 0.42)) * (p > 0.14 && p < 0.42 ? 1 : 0) + 6 * Math.sin(Math.PI * seg(p, 0.5, 0.66)) * (p > 0.5 && p < 0.66 ? 1 : 0)
      const s = -0.12 * bump(p, 0.04, 0.16) + 0.08 * hop1 * (1 - seg(p, 0.2, 0.42)) - 0.11 * bump(p, 0.4, 0.52) + 0.04 * hop2 - 0.06 * bump(p, 0.64, 0.74) + 0.05 * settle(p, 0.72, 3, 9)
      const twinkle = 1 + 0.35 * Math.max(0, wave(p, 3))
      const g = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${n(r)}" fill="#fff"/>`
      return {
        behind: about(60, 64, { sx: 1 + 0.035 * (bump(p, 0.4, 0.56) + 0.6 * bump(p, 0.64, 0.78)) - 0.02 * bump(p, 0.04, 0.16), sy: 1 - 0.025 * bump(p, 0.4, 0.56) }),
        body: about(60, 94, { ty: -lift, ...squash(s) }),
        over: about(60, 94, { ty: -lift, ...squash(s) }),
        face: about(60, 94, { ty: -lift, ...squash(s) }),
        eyes:
          `<circle cx="48" cy="58" r="6" fill="${INK}"/><circle cx="72" cy="58" r="6" fill="${INK}"/>` +
          g(50, 55.5, 2.2 * twinkle) + g(74, 55.5, 2.2 * twinkle) + g(46.5, 60, 1) + g(70.5, 60, 1),
        front:
          float(seg(p, 0.2, 0.62), { x: 26, y: 40, rise: 14, svg: SPARKLE, from: 0.2, to: 0.9, sway: 2, rot: 20 }) +
          float(seg(p, 0.28, 0.72), { x: 96, y: 34, rise: 12, svg: SPARKLE, from: 0.2, to: 0.7, sway: 2, rot: -20 })
      }
    }
  },
  {
    // Nắng laughs out loud: quick ha-ha bounces, rays spinning, the head rocking.
    id: 'cuoi',
    pose: (p) => {
      const b = Math.abs(Math.sin(TAU * 2 * p))
      return {
        root: about(60, 104, { ty: -5 * b ** 1.4, rot: 5 * wave(p), ...squash(0.06 * b - 0.03 * (1 - b) ** 6) }),
        body: about(60, 62, { rot: 36 * p }),
        mouth: about(60, 70, { sy: 1 + 0.18 * b })
      }
    }
  },
  {
    // Cỏ winks: it opens the winking eye for a moment, leans away, then snaps the wink back with a tilt and a sparkle.
    id: 'nhay',
    pose: (p) => {
      const open = bump(p, 0.36, 0.6)
      const lean = -4 * bump(p, 0.32, 0.6) + 9 * ease(seg(p, 0.58, 0.64)) * (1 - ease(seg(p, 0.66, 0.96))) + 3 * settle(p, 0.64, 2.2, 6)
      const arc = 1 - ease(seg(open, 0, 0.4))
      return {
        root: about(60, 112, { rot: lean, ...squash(0.04 * bump(p, 0.56, 0.7) - 0.03 * bump(p, 0.32, 0.5)) }),
        body: about(60, 62, { rot: 3 * wave(p) }),
        eyes:
          `<circle cx="48" cy="58" r="4.8" fill="${INK}"/>` +
          `<g opacity="${n(arc)}"><path d="M65 59q7-8 14 0" ${stroke}/></g>` +
          `<g transform="${about(72, 58, { sy: Math.max(0.05, ease(seg(open, 0.25, 0.9))) })}"><circle cx="72" cy="58" r="4.8" fill="${INK}"/></g>`,
        front: float(seg(p, 0.6, 0.98), { x: 96, y: 34, rise: 8, svg: SPARKLE, from: 0.3, to: 1.1, sway: 1, rot: 35 })
      }
    }
  },
  {
    // Ma nhỏ floats about, skirt rippling, tongue wiggling.
    id: 'le',
    pose: (p) => {
      // the hem: round scallops travelling along it, one scallop's width per loop
      let d = 'M22 60c0-26 17-46 38-46s38 20 38 46V100'
      const lobes = 4
      const w = 76 / lobes
      for (let i = 0; i <= 48; i++) {
        const x = 98 - (76 * i) / 48
        const y = 100 + 7 * Math.abs(Math.sin((Math.PI * (x - 22)) / w + Math.PI * p))
        d += `L${n(x)} ${n(y)}`
      }
      d += 'Z'
      const tongue = -22 + 12 * wave(p, 3)
      return {
        root: about(60, 104, { ty: -5 * wave(p), rot: 4 * wave(p, 2) }),
        bodyMarkup: `<path d="${d}"/>`,
        eyes: about(60, 59, { sy: 1 - 0.92 * bump(p, 0.7, 0.79) }),
        mouth:
          `<g transform="translate(67 72) rotate(${n(tongue)})"><path d="M-5 0v5a5 5 0 0 0 10 0v-5z" fill="#ff6f8e"/><path d="M0 1.5v7" stroke="#e24a72" stroke-width="1.6" stroke-linecap="round"/></g>` +
          `<path d="M50 71q9 4 22-3" ${stroke}/>`
      }
    }
  },
  {
    // Mây in love: heart eyes beating (lub-dub, twice), the body squishing along, hearts floating up.
    id: 'yeu',
    pose: (p) => {
      const beat = gauss(p, 0.14, 0.04) + 0.7 * gauss(p, 0.27, 0.035) + gauss(p, 0.64, 0.04) + 0.7 * gauss(p, 0.77, 0.035)
      const s = 1 + 0.32 * beat
      const H = heart(0, 0, 1, PINK) + '<circle cx="-3.6" cy="-3.2" r="1.4" fill="#fff" opacity=".8"/>'
      return {
        root: about(60, 108, squash(0.045 * beat)),
        eyes: heart(48, 58, s, PINK) + heart(72, 58, s, PINK),
        front: [0, 1 / 3, 2 / 3].map((o, i) => float((p + o) % 1, { x: [34, 86, 60][i], y: 22, rise: 34, svg: H, from: 0.5, to: [1.1, 0.9, 1.25][i], sway: 4, rot: 12 })).join('')
      }
    }
  },
  {
    // Mây blows a kiss: winds up, leans in, and a heart flies off from its lips.
    id: 'hon',
    pose: (p) => {
      const wind = bump(p, 0.08, 0.36)
      const thrust = ease(seg(p, 0.3, 0.4)) * (1 - ease(seg(p, 0.42, 0.62)))
      const rot = -6 * wind + 9 * thrust + 4 * settle(p, 0.55, 2, 5)
      const pucker = 1 + 0.3 * wind - 0.1 * thrust
      const fly = seg(p, 0.38, 0.95)
      const hx = 70 + 40 * ease(fly)
      const hy = 74 - 70 * ease(fly) + 14 * Math.sin(Math.PI * fly)
      const hs = 0.4 + 1.1 * ease(seg(fly, 0, 0.6))
      const ho = fly <= 0 ? 0 : ease(seg(fly, 0, 0.1)) * (1 - ease(seg(fly, 0.7, 1)))
      return {
        root: about(60, 108, { rot, tx: 3 * thrust, ...squash(-0.05 * wind + 0.05 * thrust) }),
        mouth: `<g transform="${about(59, 74, { sx: pucker, sy: pucker })}"><path d="M58 69q6 2 1 5 5 3-1 6" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></g>`,
        front: ho > 0 ? `<g transform="translate(${n(hx)} ${n(hy)}) rotate(${n(18 * Math.sin(TAU * fly))}) scale(${n(hs)})" opacity="${n(ho)}">${heart(0, 0, 1.3, PINK)}<circle cx="-4.5" cy="-4" r="1.8" fill="#fff" opacity=".8"/></g>` : ''
      }
    }
  },
  {
    // Bông is startled: a crouch, a jump with eyes going wide, a squashy landing and a wobble; "!!" pops above.
    id: 'ngac',
    pose: (p) => {
      const air = p > 0.16 && p < 0.46 ? Math.sin(Math.PI * seg(p, 0.16, 0.46)) : 0
      const s = -0.12 * bump(p, 0.04, 0.18) + 0.1 * air * (1 - seg(p, 0.2, 0.4)) - 0.13 * bump(p, 0.44, 0.56) + 0.06 * settle(p, 0.54, 3, 8)
      const wide = 1 + 0.2 * ease(seg(p, 0.14, 0.24)) * (1 - ease(seg(p, 0.6, 0.85)))
      const bang = seg(p, 0.18, 0.7)
      const bo = bang <= 0 || bang >= 1 ? 0 : ease(seg(bang, 0, 0.15)) * (1 - ease(seg(bang, 0.75, 1)))
      const bs = 0.4 + 0.7 * ease(seg(bang, 0, 0.25)) - 0.1 * ease(seg(bang, 0.25, 0.5))
      const mark = (x, r) => `<g transform="translate(${x} 0) rotate(${r})"><path d="M0-12v12" fill="none" stroke="${INK}" stroke-width="5.5" stroke-linecap="round"/><circle cx="0" cy="8" r="3" fill="${INK}"/></g>`
      return {
        root: about(60, 116, { ty: -18 * air, ...squash(s) }),
        eyes: about(60, 57, { sx: wide, sy: wide }),
        mouth: about(60, 77, { sx: 1 + 0.35 * (wide - 1) * 5, sy: 1 + 0.5 * (wide - 1) * 5 }),
        front: bo > 0 ? `<g transform="translate(60 ${n(4 - 18 * air)}) scale(${n(bs)})" opacity="${n(bo)}">${mark(-8, -12)}${mark(8, 12)}</g>` : ''
      }
    }
  },
  {
    // Giọt can't be bothered: a slow sway and sag, eyes rolling side to side, a lazy half blink.
    id: 'luoi',
    pose: (p) => {
      const look = -ease(seg(p, 0.08, 0.22)) + 2 * ease(seg(p, 0.4, 0.56)) - ease(seg(p, 0.78, 0.94))
      const sag = (1 - Math.cos(TAU * p)) / 2
      const lid = 1 - 0.55 * bump(p, 0.62, 0.76)
      const sclera = FACE.meh.eyes.split('<circle')[0]
      return {
        root: about(60, 114, { rot: 3 * wave(p), ...squash(-0.03 * sag) }),
        eyes:
          `<g transform="${about(60, 56, { sy: lid })}">${sclera}` +
          `<circle cx="${n(47 + 4 * look)}" cy="61.5" r="4.2" fill="${INK}"/><circle cx="${n(73 + 4 * look)}" cy="61.5" r="4.2" fill="${INK}"/></g>`
      }
    }
  },
  {
    // Hoa dozes: slow breaths, a nodding head, z's drifting up.
    id: 'ngu',
    pose: (p) => {
      const breath = (1 - Math.cos(TAU * p)) / 2
      return {
        root: about(60, 114, { rot: -4 * breath, sx: 1 + 0.02 * breath, sy: 1 + 0.035 * breath }),
        mouth: about(60, 74, { sx: 1 - 0.15 * breath, sy: 1 + 0.6 * breath }),
        front: [0, 1 / 3, 2 / 3].map((o, i) => float((p + o) % 1, { x: 92, y: 30, rise: 40, svg: Z, from: 0.45, to: [1, 0.8, 1.15][i], sway: 6, rot: 10 })).join('')
      }
    }
  },
  {
    // Flan is cross: it trembles, wobbles like the jelly it is, an anger mark throbbing; the plate stays put.
    id: 'gian',
    pose: (p) => {
      const jelly = { tx: 1.1 * wave(p, 12), skew: 6 * wave(p, 2), ...squash(0.04 * wave(p, 4)) }
      const throb = 1 + 0.16 * Math.max(0, wave(p, 4))
      const vein = `<g transform="translate(95 26) rotate(12) scale(${n(throb)})"><path d="M-9-3q4-1 5-6M3-9q1 4 6 5M9 3q-4 1-5 6M-3 9q-1-4-6-5" fill="none" stroke="#ff3b5c" stroke-width="4" stroke-linecap="round"/></g>`
      return {
        body: about(60, 106, jelly),
        over: about(60, 106, jelly),
        face: about(60, 106, jelly),
        front: vein
      }
    }
  },
  {
    // Bông is about to cry: sobs, a shiver, glossy eyes brimming, tears rolling down and dropping off.
    id: 'khoc',
    pose: (p) => {
      const sob = bump(p, 0.1, 0.24) + 0.8 * bump(p, 0.56, 0.7)
      const tear = (q, x) => {
        if (q <= 0 || q >= 1) return ''
        const grow = ease(seg(q, 0, 0.18))
        const slide = ease(seg(q, 0.15, 0.6))
        const fall = seg(q, 0.6, 1) ** 2
        const y = 64 + 18 * slide + 40 * fall
        const o = 1 - ease(seg(q, 0.82, 1))
        return `<g transform="translate(${n(x - 2 * slide)} ${n(y)}) scale(${n(0.3 + 0.55 * grow)})" opacity="${n(o)}">${drop()}</g>`
      }
      const glint = 0.7 * wave(p, 4)
      return {
        root: about(60, 116, { tx: 0.7 * wave(p, 16) * (0.3 + sob), ty: 1.5 * sob, ...squash(-0.05 * sob) }),
        eyes:
          `<circle cx="48" cy="58" r="7.5" fill="${INK}"/><circle cx="72" cy="58" r="7.5" fill="${INK}"/>` +
          `<path d="M40.8 60a7.5 7.5 0 0 0 14.4 0zM64.8 60a7.5 7.5 0 0 0 14.4 0z" fill="#6cc0ff" opacity="${n(0.85 + 0.15 * wave(p, 3))}"/>` +
          `<circle cx="${n(50.5 + glint)}" cy="55" r="2.6" fill="#fff"/><circle cx="${n(74.5 + glint)}" cy="55" r="2.6" fill="#fff"/>` +
          `<circle cx="46" cy="59" r="1.2" fill="#fff"/><circle cx="70" cy="59" r="1.2" fill="#fff"/>`,
        mouth: `<path d="M54 ${n(77 + 0.8 * wave(p, 6))}q6 ${n(-5 - 1.2 * sob)} 12 0" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>` + tear(p, 42) + tear((p + 0.5) % 1, 78) + tear((p + 0.25) % 1, 42) + tear((p + 0.75) % 1, 78)
      }
    }
  }
]

/** The stickers, each with its pose and its loop in seconds. */
export const PALS_STICKERS = LIST.map((s) => ({ ...s, loop: s.loop / 1000, pose: POSES.find((m) => m.id === s.id).pose }))

/** The whole frame at phase p, as an SVG of the given size (pixels) over a roomy artboard. */
export function frameSvg(sticker, p, size) {
  const m = member(sticker.pal)
  const parts = palParts(specOf(m, sticker.face), sticker.id)
  const pose = sticker.pose(p)
  const g = (t, inner) => (t ? `<g transform="${t}">${inner}</g>` : inner)
  // a transform string, or replacement markup (starts with "<")
  const part = (value, fallback) => (typeof value === 'string' && value.startsWith('<') ? value : g(value, fallback))
  const face =
    `<g transform="translate(${parts.face.x} ${parts.face.y}) scale(${parts.face.scale}) translate(-60 -62)">` +
    parts.blush +
    part(pose.eyes, parts.eyes) +
    part(pose.mouth, parts.mouth) +
    '</g>'
  const pal =
    g(pose.behind, parts.behind) +
    g(pose.body, `<g fill="url(#${parts.fill})">${pose.bodyMarkup ?? parts.body}</g>`) +
    g(pose.over, parts.over) +
    g(pose.face, face) +
    parts.extra
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-30 -40 180 180" width="${size}" height="${size}">` +
    `<defs>${parts.defs}</defs>` +
    (pose.back ?? '') +
    g(pose.root, pal) +
    (pose.front ?? '') +
    '</svg>'
  )
}
