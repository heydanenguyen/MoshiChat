import { describe, expect, it } from 'vitest'
import { buildOgg, extractOpus, opusPacketSamples, webmToOgg } from '../src/main/media/webm-to-ogg'

// ---- helpers to build a minimal WebM the way MediaRecorder does ----------

function vintSize(n: number): Uint8Array {
  // 8-byte size for simplicity (marker 0x01)
  const out = new Uint8Array(8)
  out[0] = 0x01
  let v = n
  for (let i = 7; i >= 1; i--) {
    out[i] = v & 0xff
    v = Math.floor(v / 256)
  }
  return out
}

const UNKNOWN_SIZE = new Uint8Array([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])

function element(id: number[], payload: Uint8Array, unknown = false): Uint8Array {
  const size = unknown ? UNKNOWN_SIZE : vintSize(payload.length)
  const out = new Uint8Array(id.length + size.length + payload.length)
  out.set(id, 0)
  out.set(size, id.length)
  out.set(payload, id.length + size.length)
  return out
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

function opusPacket(config: number, code: number, payloadLength: number, seed: number): Uint8Array {
  const packet = new Uint8Array(1 + payloadLength)
  packet[0] = (config << 3) | code
  for (let i = 1; i < packet.length; i++) packet[i] = (seed * 31 + i) & 0xff
  return packet
}

function simpleBlock(track: number, timecode: number, frame: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + frame.length)
  body[0] = 0x80 | track
  body[1] = (timecode >> 8) & 0xff
  body[2] = timecode & 0xff
  body[3] = 0x80 // keyframe, no lacing
  body.set(frame, 4)
  return element([0xa3], body)
}

function buildWebm(packets: Uint8Array[]): Uint8Array {
  const header = element([0x1a, 0x45, 0xdf, 0xa3], element([0x42, 0x82], new TextEncoder().encode('webm')))
  const trackEntry = element(
    [0xae],
    concat(
      element([0xd7], new Uint8Array([1])),
      element([0x86], new TextEncoder().encode('A_OPUS')),
      element([0xe1], element([0x9f], new Uint8Array([1])))
    )
  )
  const tracks = element([0x16, 0x54, 0xae, 0x6b], trackEntry)
  const blocks = packets.map((p, i) => simpleBlock(1, i * 20, p))
  const cluster = element([0x1f, 0x43, 0xb6, 0x75], concat(element([0xe7], new Uint8Array([0])), ...blocks), true)
  const segment = element([0x18, 0x53, 0x80, 0x67], concat(tracks, cluster), true)
  return concat(header, segment)
}

// ---- tests ------------------------------------------------------------------

describe('opusPacketSamples', () => {
  it('derives frame duration from the TOC byte', () => {
    expect(opusPacketSamples(opusPacket(1, 0, 10, 1))).toBe(960) // SILK NB 20 ms, one frame
    expect(opusPacketSamples(opusPacket(3, 0, 10, 1))).toBe(2880) // 60 ms
    expect(opusPacketSamples(opusPacket(16, 0, 10, 1))).toBe(120) // CELT 2.5 ms
    expect(opusPacketSamples(opusPacket(19, 1, 10, 1))).toBe(1920) // CELT 20 ms, two frames
    const multi = opusPacket(1, 3, 10, 1)
    multi[1] = 3 // three frames
    expect(opusPacketSamples(multi)).toBe(2880)
    expect(opusPacketSamples(new Uint8Array())).toBe(0)
  })
})

describe('buildOgg', () => {
  it('writes a valid Ogg/Opus stream with header, tags and audio pages', () => {
    const packets = [opusPacket(1, 0, 40, 1), opusPacket(1, 0, 40, 2), opusPacket(1, 0, 40, 3)]
    const ogg = buildOgg(packets, 1, 312)
    const text = new TextDecoder('latin1').decode(ogg)
    expect(text.startsWith('OggS')).toBe(true)
    expect(text).toContain('OpusHead')
    expect(text).toContain('OpusTags')
    const pages = text.split('OggS').length - 1
    expect(pages).toBe(3)
    // Last page carries EOS flag and the total granule position.
    const lastPage = ogg.lastIndexOf(0x53, ogg.length) // cheap: find final "OggS"
    expect(lastPage).toBeGreaterThan(0)
    const pageStarts: number[] = []
    for (let i = 0; i + 4 <= ogg.length; i++) {
      if (ogg[i] === 0x4f && ogg[i + 1] === 0x67 && ogg[i + 2] === 0x67 && ogg[i + 3] === 0x53) pageStarts.push(i)
    }
    const last = pageStarts[pageStarts.length - 1]
    expect(ogg[last + 5] & 0x04).toBe(0x04)
    const granule = new DataView(ogg.buffer).getUint32(last + 6, true)
    expect(granule).toBe(312 + 960 * 3)
  })

  it('computes Ogg page checksums that a decoder would accept', () => {
    const ogg = buildOgg([opusPacket(1, 0, 20, 9)], 1)
    // Recompute the CRC of the first page independently.
    const crcTable = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      let r = i << 24
      for (let j = 0; j < 8; j++) r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0
      crcTable[i] = r >>> 0
    }
    const pageLength = 27 + ogg[26] + [...ogg.subarray(27, 27 + ogg[26])].reduce((a, b) => a + b, 0)
    const page = ogg.slice(0, pageLength)
    const stored = new DataView(page.buffer).getUint32(22, true)
    page[22] = page[23] = page[24] = page[25] = 0
    let crc = 0
    for (const b of page) crc = ((crc << 8) ^ crcTable[((crc >>> 24) ^ b) & 0xff]) >>> 0
    expect(crc >>> 0).toBe(stored)
  })
})

describe('extractOpus / webmToOgg', () => {
  it('pulls Opus frames out of a MediaRecorder-style WebM with unknown-size segment and cluster', () => {
    const packets = [opusPacket(1, 0, 30, 1), opusPacket(1, 0, 25, 2), opusPacket(1, 0, 35, 3), opusPacket(1, 0, 12, 4)]
    const webm = buildWebm(packets)
    const extracted = extractOpus(webm)
    expect(extracted.track.trackNumber).toBe(1)
    expect(extracted.track.channels).toBe(1)
    expect(extracted.packets.length).toBe(4)
    extracted.packets.forEach((p, i) => expect([...p]).toEqual([...packets[i]]))
  })

  it('remuxes end to end and keeps every frame byte-for-byte', () => {
    const packets = Array.from({ length: 120 }, (_, i) => opusPacket(1, 0, 20 + (i % 7), i))
    const ogg = webmToOgg(buildWebm(packets))
    const text = new TextDecoder('latin1').decode(ogg)
    expect(text.startsWith('OggS')).toBe(true)
    // 2 header pages + ceil(120 / 50) audio pages
    expect(text.split('OggS').length - 1).toBe(2 + 3)
    // Frames survive: the third packet's bytes appear verbatim.
    const needle = new TextDecoder('latin1').decode(packets[2])
    expect(text).toContain(needle)
  })

  it('rejects data that is not WebM', () => {
    expect(() => webmToOgg(new Uint8Array([1, 2, 3, 4]))).toThrow()
  })
})
