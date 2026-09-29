import { describe, expect, it } from 'vitest'
import { EASES, MOTIONS, bezier, samplePose, stickerFrameAttrs, stickerMotionCss } from '../src/shared/sticker-motion'
import { stickerIds, stickerMarkup, stickerParts } from '../src/shared/stickers'

describe('sticker motion', () => {
  it('eases like CSS cubic-bezier', () => {
    expect(bezier(EASES.linear, 0.3)).toBeCloseTo(0.3, 4)
    expect(bezier(EASES.inOut, 0.5)).toBeCloseTo(0.5, 3)
    expect(bezier(EASES.out, 0.5)).toBeGreaterThan(0.8)
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => bezier(EASES.back, i / 50)))).toBeGreaterThan(1)
  })

  it('every part starts on its still pose and ends on it (or a symmetric turn), so play/stop never jumps', () => {
    for (const [expression, motion] of Object.entries(MOTIONS)) {
      const tracks = [motion.body, motion.eyes, motion.mouth, ...(motion.props ?? [])].filter(Boolean)
      for (const track of tracks) {
        const keys = [...track!.keys].sort((a, b) => a.at - b.at)
        expect(keys[0].at, expression).toBe(0)
        expect(keys[keys.length - 1].at, expression).toBe(1)
        for (const k of keys) expect(k.at >= 0 && k.at <= 1, `${expression} key at ${k.at}`).toBe(true)
        for (const pose of [samplePose(track!, 0), (() => { const k = keys[keys.length - 1]; return { tx: k.tx ?? 0, ty: k.ty ?? 0, r: k.r ?? 0, sx: k.sx ?? k.s ?? 1, sy: k.sy ?? k.s ?? 1, o: k.o ?? 1 } })()]) {
          expect(Math.abs(pose.tx) + Math.abs(pose.ty), expression).toBeLessThan(1e-6)
          expect(Math.abs(pose.sx - 1) + Math.abs(pose.sy - 1) + Math.abs(pose.o - 1), expression).toBeLessThan(1e-6)
          expect(Math.abs(pose.r) % 90, `${expression} rotation ${pose.r}`).toBeLessThan(1e-6)
        }
      }
    }
  })

  it('produces CSS and frames for all 72 stickers, and the still markup has no transforms', () => {
    for (const id of stickerIds()) {
      const css = stickerMotionCss(id)
      expect(css).toContain(`.stk-${id}.stk-play .stk-body`)
      expect(css).not.toContain('NaN')
      const frame = stickerFrameAttrs(id, 0.37)
      expect(frame.body).toMatch(/^transform="translate\(/)
      expect(stickerMarkup(id, frame)).toContain('transform="translate(')
      expect(stickerMarkup(id)).not.toContain('transform="translate(')
      expect(stickerParts(id).props.length).toBeGreaterThan(0)
    }
  })
})
