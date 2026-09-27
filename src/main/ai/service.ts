import { app, session, utilityProcess, type UtilityProcess } from 'electron'
import { readFile, rm, stat, writeFile, readdir } from 'fs/promises'
import { join } from 'path'
import { AI_MODELS, NLLB, detectLanguage, translationChunks, type AiKind, type AiModelSpec, type AiProgress, type AiStatus, type VoiceModel } from '@shared/ai'

/** The worker goes away after this long without work, giving its memory back. */
const IDLE_MS = 10 * 60 * 1000
const CACHE_LIMIT = 3000
const MEDIA_HOSTS = /(^|\.)(fbcdn\.net|cdninstagram\.com|instagram\.com|facebook\.com|fbsbx\.com|zdn\.vn|zadn\.vn|zaloapp\.com|telegram\.org|whatsapp\.net)$/i

type Pending = { resolve(value: unknown): void; reject(err: Error): void }
type Cache = { transcripts: Record<string, string>; translations: Record<string, string> }

const modelsDir = (): string => join(app.getPath('userData'), 'models')

/** The ONNX files a model needs, from its quantisation (transformers.js naming). */
function expectedFiles(spec: AiModelSpec): string[] {
  const suffix = (dtype: string): string => (dtype === 'q8' ? '_quantized' : dtype === 'fp32' ? '' : `_${dtype}`)
  const of = (file: string): string => suffix(typeof spec.dtype === 'string' ? spec.dtype : (spec.dtype[file] ?? 'fp32'))
  return ['encoder_model', 'decoder_model_merged'].map((f) => join(modelsDir(), ...spec.repo.split('/'), 'onnx', `${f}${of(f)}.onnx`))
}

async function present(spec: AiModelSpec): Promise<boolean> {
  for (const file of expectedFiles(spec)) {
    const info = await stat(file).catch(() => undefined)
    if (!info || info.size < 1024 * 1024) return false
  }
  return true
}

async function folderSize(dir: string): Promise<number> {
  let total = 0
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, entry.name)
    total += entry.isDirectory() ? await folderSize(p) : ((await stat(p).catch(() => undefined))?.size ?? 0)
  }
  return total
}

export class AiService {
  private worker: UtilityProcess | undefined
  private pending = new Map<number, Pending>()
  private nextId = 1
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private cache: Cache = { transcripts: {}, translations: {} }
  private cacheLoaded = false
  private saveTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private voiceModel: () => VoiceModel,
    private language: () => string,
    private onProgress: (progress: AiProgress) => void,
    private log: (...args: unknown[]) => void
  ) {}

  private get cacheFile(): string {
    return join(app.getPath('userData'), 'ai-cache.json')
  }

  async cached(): Promise<Cache> {
    if (!this.cacheLoaded) {
      this.cacheLoaded = true
      try {
        this.cache = { transcripts: {}, translations: {}, ...(JSON.parse(await readFile(this.cacheFile, 'utf8')) as Partial<Cache>) }
      } catch {
        /* first use */
      }
    }
    return this.cache
  }

  private remember(bucket: keyof Cache, key: string, value: string): void {
    const map = this.cache[bucket]
    delete map[key]
    map[key] = value
    const keys = Object.keys(map)
    for (const old of keys.slice(0, Math.max(0, keys.length - CACHE_LIMIT))) delete map[old]
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void writeFile(this.cacheFile, JSON.stringify(this.cache)).catch(() => undefined), 1500)
  }

  async status(): Promise<AiStatus> {
    const model = this.voiceModel()
    return {
      voice: { model, ready: await present(AI_MODELS.voice[model]) },
      translate: { ready: await present(AI_MODELS.translate) },
      bytes: await folderSize(modelsDir())
    }
  }

  private spawn(): UtilityProcess {
    if (this.worker) return this.worker
    const worker = utilityProcess.fork(join(__dirname, 'ai-worker.js'), [], { serviceName: 'Unison AI', stdio: 'pipe' })
    worker.stdout?.on('data', (d) => this.log('[ai]', String(d).trim()))
    worker.stderr?.on('data', (d) => this.log('[ai:err]', String(d).trim()))
    worker.on('message', (m: { type: string; id?: number; value?: unknown; message?: string } & Partial<AiProgress>) => {
      if (m.type === 'progress' && m.kind && m.phase) this.onProgress({ kind: m.kind, phase: m.phase, progress: m.progress, error: m.error })
      else if (m.type === 'log') this.log('[ai]', m.message)
      else if ((m.type === 'result' || m.type === 'error') && m.id !== undefined) {
        const pending = this.pending.get(m.id)
        this.pending.delete(m.id)
        if (m.type === 'result') pending?.resolve(m.value)
        else pending?.reject(new Error(m.message ?? 'AI error'))
      }
    })
    worker.on('exit', () => {
      this.worker = undefined
      for (const p of this.pending.values()) p.reject(new Error('The AI worker stopped'))
      this.pending.clear()
    })
    worker.postMessage({ type: 'init', cacheDir: modelsDir() })
    this.worker = worker
    return worker
  }

  private request<T>(message: Record<string, unknown>): Promise<T> {
    const worker = this.spawn()
    const id = this.nextId++
    if (this.idleTimer) clearTimeout(this.idleTimer)
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      worker.postMessage({ ...message, id })
    }).finally(() => {
      if (this.idleTimer) clearTimeout(this.idleTimer)
      this.idleTimer = setTimeout(() => this.stop(), IDLE_MS)
    })
  }

  stop(): void {
    this.worker?.kill()
    this.worker = undefined
  }

  /** Download (first time) and load a model. */
  prepare(kind: AiKind): Promise<boolean> {
    return this.request<boolean>({ type: 'prepare', kind, voiceModel: this.voiceModel() })
  }

  async remove(kind: AiKind): Promise<void> {
    this.stop()
    const repos = kind === 'voice' ? Object.values(AI_MODELS.voice).map((m) => m.repo) : [AI_MODELS.translate.repo]
    for (const repo of repos) await rm(join(modelsDir(), ...repo.split('/')), { recursive: true, force: true })
  }

  async transcribe(key: string, pcm: Float32Array, language?: string): Promise<string> {
    const cache = await this.cached()
    if (cache.transcripts[key] !== undefined) return cache.transcripts[key]
    const text = await this.request<string>({ type: 'transcribe', voiceModel: this.voiceModel(), audio: pcm, language: language ?? this.language() })
    this.remember('transcripts', key, text)
    return text
  }

  /** Translate into the app language. `same` when the text already is in that language. */
  async translate(key: string, text: string): Promise<{ text: string; from: string; same?: boolean }> {
    const target = this.language()
    const from = detectLanguage(text)
    if (from === target) return { text, from, same: true }
    const cache = await this.cached()
    const cacheKey = `${key}|${target}`
    if (cache.translations[cacheKey] !== undefined) return { text: cache.translations[cacheKey], from }
    const src = NLLB[from] ?? NLLB.en
    const tgt = NLLB[target] ?? NLLB.en
    const paragraphs = translationChunks(text)
    const parts = await this.request<string[]>({ type: 'translate', texts: paragraphs.flat(), src, tgt })
    let i = 0
    const result = paragraphs.map((sentences) => sentences.map(() => parts[i++] ?? '').join(' ')).join('\n')
    this.remember('translations', cacheKey, result)
    return { text: result, from }
  }
}

/** Bytes of a voice note for the renderer to decode: data URLs, files, or platform CDNs through their session. */
export async function readMedia(url: string): Promise<Uint8Array> {
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',')
    const meta = url.slice(5, comma)
    const body = url.slice(comma + 1)
    return meta.endsWith(';base64') ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body))
  }
  const target = new URL(url)
  if (target.protocol === 'file:') return readFile(target)
  if (target.protocol !== 'https:' || !MEDIA_HOSTS.test(target.hostname)) throw new Error('This media host is not allowed')
  const instagram = /instagram|cdninstagram/.test(target.hostname) || target.searchParams.has('_nc_cat')
  const ses = /fbcdn|cdninstagram|instagram|facebook|fbsbx/.test(target.hostname)
    ? session.fromPartition(instagram ? 'persist:login-instagram' : 'persist:login-messenger')
    : session.defaultSession
  const res = await ses.fetch(target.toString(), { headers: { Referer: instagram ? 'https://www.instagram.com/' : 'https://www.facebook.com/' } })
  if (!res.ok) throw new Error(`Could not load the voice note (${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > 40 * 1024 * 1024) throw new Error('This voice note is too long')
  return buf
}
