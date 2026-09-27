/**
 * Moshi's own notification sounds, synthesised with Web Audio (no audio files, nothing licensed):
 * short, bright and playful like the logo characters. Each sound is a few enveloped oscillators and
 * noise bursts through a soft room echo.
 */
import type { SoundId } from '@shared/types'

export const SOUND_IDS: SoundId[] = ['bubbles', 'chirp', 'boing', 'twinkle', 'marimba', 'smooch']

export const SOUND_NAMES: Record<SoundId | 'off', { vi: string; en: string; emoji: string }> = {
  bubbles: { vi: 'Bong bóng', en: 'Bubbles', emoji: '🫧' },
  chirp: { vi: 'Líu lo', en: 'Birdie', emoji: '🐦' },
  boing: { vi: 'Boing', en: 'Boing', emoji: '🦘' },
  twinkle: { vi: 'Lấp lánh', en: 'Twinkle', emoji: '✨' },
  marimba: { vi: 'Gõ gỗ', en: 'Marimba', emoji: '🪵' },
  smooch: { vi: 'Chụt', en: 'Smooch', emoji: '💋' },
  off: { vi: 'Tắt', en: 'Off', emoji: '🔕' }
}

let ctx: AudioContext | undefined
let bus: GainNode | undefined

/** Gentle glue: a soft compressor and a short, bright room so the blips feel round, not clicky. */
function buildBus(c: BaseAudioContext): GainNode {
  const comp = c.createDynamicsCompressor()
  comp.threshold.value = -14
  comp.ratio.value = 3
  comp.attack.value = 0.003
  comp.release.value = 0.12
  comp.connect(c.destination)
  const input = c.createGain()
  input.connect(comp)
  const delay = c.createDelay(0.5)
  delay.delayTime.value = 0.085
  const feedback = c.createGain()
  feedback.gain.value = 0.22
  const wet = c.createGain()
  wet.gain.value = 0.16
  const tone = c.createBiquadFilter()
  tone.type = 'highpass'
  tone.frequency.value = 900
  input.connect(delay)
  delay.connect(tone)
  tone.connect(feedback)
  feedback.connect(delay)
  tone.connect(wet)
  wet.connect(comp)
  return input
}

function audio(): { ctx: AudioContext; out: GainNode } {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' })
    bus = buildBus(ctx)
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return { ctx, out: bus! }
}

interface Tone {
  type?: OscillatorType
  from: number
  to?: number
  at: number
  dur: number
  gain: number
  attack?: number
  glide?: number
  vibrato?: { rate: number; depth: number }
}

function tone(c: BaseAudioContext, out: AudioNode, v: number, t: Tone): void {
  const start = c.currentTime + t.at
  const osc = c.createOscillator()
  osc.type = t.type ?? 'sine'
  osc.frequency.setValueAtTime(t.from, start)
  if (t.to) osc.frequency.exponentialRampToValueAtTime(t.to, start + (t.glide ?? t.dur * 0.5))
  if (t.vibrato) {
    const lfo = c.createOscillator()
    const depth = c.createGain()
    lfo.frequency.value = t.vibrato.rate
    depth.gain.setValueAtTime(t.vibrato.depth, start)
    depth.gain.exponentialRampToValueAtTime(1, start + t.dur)
    lfo.connect(depth)
    depth.connect(osc.frequency)
    lfo.start(start)
    lfo.stop(start + t.dur + 0.05)
  }
  const env = c.createGain()
  const peak = Math.max(0.0002, t.gain * v)
  env.gain.setValueAtTime(0.0001, start)
  env.gain.exponentialRampToValueAtTime(peak, start + (t.attack ?? 0.006))
  env.gain.exponentialRampToValueAtTime(0.0001, start + t.dur)
  osc.connect(env)
  env.connect(out)
  osc.start(start)
  osc.stop(start + t.dur + 0.05)
}

function noise(c: BaseAudioContext, out: AudioNode, v: number, n: { at: number; dur: number; gain: number; from: number; to?: number; q?: number }): void {
  const start = c.currentTime + n.at
  const length = Math.ceil(c.sampleRate * n.dur)
  const buffer = c.createBuffer(1, length, c.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  const src = c.createBufferSource()
  src.buffer = buffer
  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = n.q ?? 4
  filter.frequency.setValueAtTime(n.from, start)
  if (n.to) filter.frequency.exponentialRampToValueAtTime(n.to, start + n.dur)
  const env = c.createGain()
  env.gain.setValueAtTime(0.0001, start)
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, n.gain * v), start + 0.004)
  env.gain.exponentialRampToValueAtTime(0.0001, start + n.dur)
  src.connect(filter)
  filter.connect(env)
  env.connect(out)
  src.start(start)
  src.stop(start + n.dur + 0.02)
}

const SOUNDS: Record<SoundId, (c: BaseAudioContext, out: AudioNode, v: number) => void> = {
  // Two bubbles popping up, the second a little higher.
  bubbles: (c, o, v) => {
    noise(c, o, v, { at: 0, dur: 0.03, gain: 0.12, from: 2400, q: 2 })
    tone(c, o, v, { from: 420, to: 1040, at: 0, dur: 0.14, glide: 0.06, gain: 0.55 })
    tone(c, o, v, { from: 620, to: 1480, at: 0.1, dur: 0.2, glide: 0.07, gain: 0.5 })
    tone(c, o, v, { type: 'triangle', from: 1480, at: 0.16, dur: 0.18, gain: 0.08 })
  },
  // A little bird: three quick rising chirps.
  chirp: (c, o, v) => {
    ;[0, 0.075, 0.15].forEach((at, i) => tone(c, o, v, { from: 1900 + i * 180, to: 3100 + i * 260, at, dur: 0.07, glide: 0.05, gain: 0.32, vibrato: { rate: 38, depth: 90 } }))
    tone(c, o, v, { type: 'triangle', from: 2600, to: 2100, at: 0.24, dur: 0.14, glide: 0.1, gain: 0.18 })
  },
  // A springy hop, like the characters bouncing.
  boing: (c, o, v) => {
    tone(c, o, v, { from: 170, to: 560, at: 0, dur: 0.42, glide: 0.09, gain: 0.55, vibrato: { rate: 17, depth: 60 } })
    tone(c, o, v, { type: 'triangle', from: 340, to: 1120, at: 0, dur: 0.3, glide: 0.09, gain: 0.14, vibrato: { rate: 17, depth: 110 } })
  },
  // Three bell notes going up (C6 E6 G6) with a shimmer on top.
  twinkle: (c, o, v) => {
    ;[1046.5, 1318.5, 1568].forEach((f, i) => {
      tone(c, o, v, { type: 'triangle', from: f, at: i * 0.075, dur: 0.55, gain: 0.34, attack: 0.004 })
      tone(c, o, v, { from: f * 2, at: i * 0.075, dur: 0.3, gain: 0.08, attack: 0.004 })
    })
  },
  // Warm wooden mallet, two notes (G5 then C6).
  marimba: (c, o, v) => {
    ;[
      [784, 0],
      [1046.5, 0.12]
    ].forEach(([f, at]) => {
      tone(c, o, v, { from: f, at, dur: 0.34, gain: 0.55, attack: 0.003 })
      tone(c, o, v, { from: f * 3.9, at, dur: 0.06, gain: 0.12, attack: 0.002 })
      noise(c, o, v, { at, dur: 0.015, gain: 0.06, from: f * 4, q: 8 })
    })
  },
  // A blown kiss: a soft smack and a happy little pop.
  smooch: (c, o, v) => {
    noise(c, o, v, { at: 0, dur: 0.05, gain: 0.3, from: 1400, to: 3200, q: 3 })
    tone(c, o, v, { from: 900, to: 1900, at: 0.035, dur: 0.12, glide: 0.04, gain: 0.4 })
    tone(c, o, v, { type: 'triangle', from: 2350, at: 0.14, dur: 0.22, gain: 0.16, vibrato: { rate: 9, depth: 40 } })
  }
}

/** Loudness matching: measured RMS of each sound brought to about the same level. */
const LEVEL: Record<SoundId | 'sent', number> = { bubbles: 1.2, chirp: 2, boing: 1.45, twinkle: 0.8, marimba: 0.8, smooch: 2.2, sent: 2.5 }

let lastPlayed = 0

/** Play a message sound (volume 0..1). Bursts of messages make one sound, not many. */
export function playSound(id: SoundId, volume: number): void {
  if (Date.now() - lastPlayed < 650) return
  lastPlayed = Date.now()
  try {
    const { ctx: c, out } = audio()
    SOUNDS[id]?.(c, out, Math.max(0, Math.min(1, volume)) * LEVEL[id])
  } catch {
    /* audio unavailable */
  }
}

function whoosh(c: BaseAudioContext, out: AudioNode, volume: number): void {
  const v = Math.max(0, volume) * 0.6
  noise(c, out, v, { at: 0, dur: 0.13, gain: 0.22, from: 700, to: 3400, q: 1.6 })
  tone(c, out, v, { from: 880, to: 1500, at: 0.02, dur: 0.1, glide: 0.06, gain: 0.12 })
}

/** A soft "whoosh" when you send. */
export function playSent(volume: number): void {
  try {
    const { ctx: c, out } = audio()
    whoosh(c, out, Math.max(0, Math.min(1, volume)) * LEVEL.sent)
  } catch {
    /* audio unavailable */
  }
}

/** Render a sound offline (for checks and for exporting previews). */
export async function renderSound(id: SoundId | 'sent', volume = 0.7, sampleRate = 44100): Promise<AudioBuffer> {
  const c = new OfflineAudioContext(1, Math.ceil(sampleRate * 1.1), sampleRate)
  const out = buildBus(c)
  if (id === 'sent') whoosh(c, out, volume * LEVEL.sent)
  else SOUNDS[id](c, out, volume * LEVEL[id])
  return c.startRendering()
}
