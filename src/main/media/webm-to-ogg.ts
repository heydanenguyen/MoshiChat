/**
 * Remux an Opus stream from a WebM container (what MediaRecorder produces in
 * Chromium) into an Ogg/Opus file. Telegram, WhatsApp and most players treat
 * Ogg/Opus as a proper voice note, while WebM is shown as a generic file.
 *
 * Pure TypeScript, no ffmpeg: Opus packets are copied verbatim, only the
 * container changes.
 */

const EBML_ID = 0x1a45dfa3
const SEGMENT_ID = 0x18538067
const CLUSTER_ID = 0x1f43b675
const SIMPLE_BLOCK_ID = 0xa3
const BLOCK_GROUP_ID = 0xa0
const BLOCK_ID = 0xa1
const TRACKS_ID = 0x1654ae6b
const TRACK_ENTRY_ID = 0xae
const TRACK_NUMBER_ID = 0xd7
const CODEC_ID = 0x86
const CODEC_PRIVATE_ID = 0x63a2
const CHANNELS_ID = 0x9f
const AUDIO_ID = 0xe1

/** Containers whose children we walk. Everything else is treated as a leaf. */
const CONTAINERS = new Set([SEGMENT_ID, CLUSTER_ID, TRACKS_ID, TRACK_ENTRY_ID, BLOCK_GROUP_ID, AUDIO_ID])

interface Vint {
  value: number
  length: number
  unknown: boolean
}

function readVint(buf: Uint8Array, pos: number, keepMarker: boolean): Vint {
  const first = buf[pos]
  if (first === undefined) throw new Error('EBML: unexpected end of data')
  let length = 1
  let mask = 0x80
  while (length <= 8 && !(first & mask)) {
    mask >>= 1
    length++
  }
  if (length > 8) throw new Error('EBML: invalid variable-length integer')
  let value = keepMarker ? first : first & (mask - 1)
  let allOnes = (first & (mask - 1)) === mask - 1
  for (let i = 1; i < length; i++) {
    const byte = buf[pos + i]
    if (byte === undefined) throw new Error('EBML: unexpected end of data')
    value = value * 256 + byte
    if (byte !== 0xff) allOnes = false
  }
  return { value, length, unknown: !keepMarker && allOnes }
}

export interface OpusTrack {
  trackNumber: number
  channels: number
  codecPrivate?: Uint8Array
}

export interface ExtractedOpus {
  track: OpusTrack
  packets: Uint8Array[]
}

/** Walk the WebM structure and collect every Opus frame in order. */
export function extractOpus(webm: Uint8Array): ExtractedOpus {
  if (readVint(webm, 0, true).value !== EBML_ID) throw new Error('Not an EBML/WebM stream')
  const tracks: OpusTrack[] = []
  const packets: Uint8Array[] = []
  let current: Partial<OpusTrack> & { codec?: string } = {}
  let opusTrackNumber: number | undefined

  const walk = (start: number, end: number): void => {
    let pos = start
    while (pos < end) {
      const id = readVint(webm, pos, true)
      pos += id.length
      const size = readVint(webm, pos, false)
      pos += size.length
      const dataStart = pos
      const dataEnd = size.unknown ? end : Math.min(end, dataStart + size.value)
      switch (id.value) {
        case TRACK_ENTRY_ID:
          current = {}
          walk(dataStart, dataEnd)
          if (current.codec === 'A_OPUS' && current.trackNumber !== undefined) {
            tracks.push({ trackNumber: current.trackNumber, channels: current.channels ?? 1, codecPrivate: current.codecPrivate })
          }
          break
        case TRACK_NUMBER_ID:
          current.trackNumber = readUint(webm, dataStart, dataEnd - dataStart)
          break
        case CODEC_ID:
          current.codec = new TextDecoder().decode(webm.subarray(dataStart, dataEnd))
          break
        case CODEC_PRIVATE_ID:
          current.codecPrivate = webm.slice(dataStart, dataEnd)
          break
        case CHANNELS_ID:
          current.channels = readUint(webm, dataStart, dataEnd - dataStart)
          break
        case SIMPLE_BLOCK_ID:
        case BLOCK_ID: {
          if (opusTrackNumber === undefined) opusTrackNumber = tracks[0]?.trackNumber
          const track = readVint(webm, dataStart, false)
          const lacing = (webm[dataStart + track.length + 2] >> 1) & 3
          if (track.value === opusTrackNumber && lacing === 0) {
            packets.push(webm.subarray(dataStart + track.length + 3, dataEnd))
          }
          break
        }
        default:
          if (CONTAINERS.has(id.value)) walk(dataStart, dataEnd)
      }
      if (size.unknown && !CONTAINERS.has(id.value)) throw new Error('EBML: unknown-size leaf element')
      pos = size.unknown ? end : dataEnd
      // Unknown-size containers (Segment, live Clusters) run to the end of the
      // parent, but a following Cluster id means the previous one ended.
      if (size.unknown && id.value === CLUSTER_ID) return
    }
  }

  // The top level: EBML header then Segment.
  let pos = 0
  while (pos < webm.length) {
    const id = readVint(webm, pos, true)
    pos += id.length
    const size = readVint(webm, pos, false)
    pos += size.length
    const dataEnd = size.unknown ? webm.length : Math.min(webm.length, pos + size.value)
    if (id.value === SEGMENT_ID) walkSegment(pos, dataEnd)
    pos = dataEnd
  }

  function walkSegment(start: number, end: number): void {
    let p = start
    while (p < end) {
      const id = readVint(webm, p, true)
      const size = readVint(webm, p + id.length, false)
      const dataStart = p + id.length + size.length
      let dataEnd = size.unknown ? end : Math.min(end, dataStart + size.value)
      if (size.unknown && id.value === CLUSTER_ID) {
        // Find the next top-level Cluster to bound this one.
        dataEnd = findNextCluster(dataStart, end)
      }
      if (id.value === TRACKS_ID || id.value === CLUSTER_ID) walk(dataStart, dataEnd)
      p = dataEnd
    }
  }

  function findNextCluster(from: number, end: number): number {
    for (let i = from; i + 4 <= end; i++) {
      if (webm[i] === 0x1f && webm[i + 1] === 0x43 && webm[i + 2] === 0xb6 && webm[i + 3] === 0x75) return i
    }
    return end
  }

  const track = tracks[0]
  if (!track) throw new Error('No Opus track found in WebM')
  return { track, packets }
}

function readUint(buf: Uint8Array, pos: number, length: number): number {
  let value = 0
  for (let i = 0; i < length; i++) value = value * 256 + buf[pos + i]
  return value
}

/** Samples (at 48 kHz) covered by an Opus packet, derived from its TOC byte. */
export function opusPacketSamples(packet: Uint8Array): number {
  if (!packet.length) return 0
  const toc = packet[0]
  const config = toc >> 3
  let frameMs: number
  if (config < 12) frameMs = [10, 20, 40, 60][config & 3]
  else if (config < 16) frameMs = [10, 20][config & 1]
  else frameMs = [2.5, 5, 10, 20][config & 3]
  const code = toc & 3
  let frames = 1
  if (code === 1 || code === 2) frames = 2
  else if (code === 3) frames = packet.length > 1 ? packet[1] & 0x3f : 1
  return Math.round(frameMs * 48 * frames)
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let r = i << 24
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0
    table[i] = r >>> 0
  }
  return table
})()

function oggCrc(bytes: Uint8Array): number {
  let crc = 0
  for (const b of bytes) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ b) & 0xff]) >>> 0
  return crc >>> 0
}

function oggPage(segments: Uint8Array[], granule: number, serial: number, seq: number, flags: number): Uint8Array {
  const lacing: number[] = []
  for (const segment of segments) {
    let remaining = segment.length
    while (remaining >= 255) {
      lacing.push(255)
      remaining -= 255
    }
    lacing.push(remaining)
  }
  const bodyLength = segments.reduce((n, s) => n + s.length, 0)
  const page = new Uint8Array(27 + lacing.length + bodyLength)
  const view = new DataView(page.buffer)
  page.set([0x4f, 0x67, 0x67, 0x53], 0) // OggS
  page[4] = 0
  page[5] = flags
  view.setUint32(6, granule >>> 0, true)
  view.setUint32(10, Math.floor(granule / 2 ** 32), true)
  view.setUint32(14, serial, true)
  view.setUint32(18, seq, true)
  view.setUint32(22, 0, true)
  page[26] = lacing.length
  page.set(lacing, 27)
  let offset = 27 + lacing.length
  for (const segment of segments) {
    page.set(segment, offset)
    offset += segment.length
  }
  view.setUint32(22, oggCrc(page), true)
  return page
}

function opusHead(channels: number, preSkip: number): Uint8Array {
  const head = new Uint8Array(19)
  const view = new DataView(head.buffer)
  head.set(new TextEncoder().encode('OpusHead'), 0)
  head[8] = 1
  head[9] = channels
  view.setUint16(10, preSkip, true)
  view.setUint32(12, 48000, true)
  view.setInt16(16, 0, true)
  head[18] = 0
  return head
}

function opusTags(): Uint8Array {
  const vendor = new TextEncoder().encode('Unison')
  const tags = new Uint8Array(8 + 4 + vendor.length + 4)
  const view = new DataView(tags.buffer)
  tags.set(new TextEncoder().encode('OpusTags'), 0)
  view.setUint32(8, vendor.length, true)
  tags.set(vendor, 12)
  view.setUint32(12 + vendor.length, 0, true)
  return tags
}

/** Build an Ogg/Opus file from raw Opus packets. */
export function buildOgg(packets: Uint8Array[], channels: number, preSkip = 312): Uint8Array {
  const serial = (Math.random() * 0xffffffff) >>> 0
  const pages: Uint8Array[] = []
  let seq = 0
  pages.push(oggPage([opusHead(channels, preSkip)], 0, serial, seq++, 0x02))
  pages.push(oggPage([opusTags()], 0, serial, seq++, 0))
  let granule = preSkip
  const PACKETS_PER_PAGE = 50
  for (let i = 0; i < packets.length; i += PACKETS_PER_PAGE) {
    const group = packets.slice(i, i + PACKETS_PER_PAGE)
    for (const packet of group) granule += opusPacketSamples(packet)
    const last = i + PACKETS_PER_PAGE >= packets.length
    pages.push(oggPage(group, granule, serial, seq++, last ? 0x04 : 0))
  }
  if (!packets.length) pages.push(oggPage([], 0, serial, seq++, 0x04))
  const total = pages.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const page of pages) {
    out.set(page, offset)
    offset += page.length
  }
  return out
}

/** WebM/Opus (MediaRecorder) to Ogg/Opus. Throws if the input has no Opus track. */
export function webmToOgg(webm: Uint8Array): Uint8Array {
  const { track, packets } = extractOpus(webm)
  let preSkip = 312
  if (track.codecPrivate && track.codecPrivate.length >= 12 && new TextDecoder().decode(track.codecPrivate.subarray(0, 8)) === 'OpusHead') {
    preSkip = new DataView(track.codecPrivate.buffer, track.codecPrivate.byteOffset).getUint16(10, true)
  }
  return buildOgg(packets, track.channels, preSkip)
}
