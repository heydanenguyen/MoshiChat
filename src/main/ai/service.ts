import { app, session, utilityProcess, type UtilityProcess } from 'electron'
import { copyFile, mkdir, readFile, rm, stat, writeFile, readdir } from 'fs/promises'
import { dirname, join } from 'path'
import { fileInside } from '../safety'
import { AI_MODELS, NLLB, aiErrorHint, detectLanguage, translationChunks, type AiKind, type AiModelSpec, type AiProgress, type AiStatus, type ChatModel, type Hardware, type SpeakLang, type VoiceModel } from '@shared/ai'
import { nativeCutoutAvailable } from '../media/mac-cutout'
import { ggufPresent, loraPath } from './llm'
import { partitionFor } from '../web-partitions'
import { openerWithContext, parseJsonLoose, parseSummary, splitReplies, summaryMessages, type ChatLine } from '@shared/ai-prompts'
import { cleanReplies, detectAddress, styleOf, type ChatContext } from '@shared/ai-context'
import { suggestReplies } from '@shared/ai-suggest'

/** The worker goes away after this long without work, giving its memory back. */
const IDLE_MS = 10 * 60 * 1000
const CACHE_LIMIT = 3000
const MEDIA_HOSTS = /(^|\.)(fbcdn\.net|cdninstagram\.com|instagram\.com|facebook\.com|fbsbx\.com|zdn\.vn|zadn\.vn|zaloapp\.com|telegram\.org|whatsapp\.net)$/i

type Pending = { resolve(value: unknown): void; reject(err: Error): void; message: Record<string, unknown>; retried?: boolean }
type Cache = { transcripts: Record<string, string>; translations: Record<string, string>; summaries: Record<string, string> }

const modelsDir = (): string => join(app.getPath('userData'), 'models')

/** The ONNX files a model needs, from its quantisation (transformers.js naming). */
function expectedFiles(spec: AiModelSpec): string[] {
  const suffix = (dtype: string): string => (dtype === 'q8' ? '_quantized' : dtype === 'fp32' ? '' : `_${dtype}`)
  const of = (file: string): string => suffix(typeof spec.dtype === 'string' ? spec.dtype : (spec.dtype[file] ?? 'fp32'))
  return (spec.files ?? ['encoder_model', 'decoder_model_merged']).map((f) => join(modelsDir(), ...spec.repo.split('/'), 'onnx', `${f}${of(f)}.onnx`))
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
  private cache: Cache = { transcripts: {}, translations: {}, summaries: {} }
  private cacheLoaded = false
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  /** DirectML crashed this machine's worker once: voice stays on the CPU from then on. */
  private gpuBroken: boolean | undefined
  /** The user's earlier replies to similar messages, for suggestions in their own voice (set by the app). */
  examplesFor?: (lines: ChatLine[], context: ChatContext, language: 'vi' | 'en') => Promise<Array<{ them: string; me: string }>>
  /** Whether the personal voice may be used (the setting; set by the app). */
  voiceAllowed: () => boolean = () => true

  constructor(
    private voiceModel: () => VoiceModel,
    private chatModel: () => ChatModel,
    private language: () => string,
    private suggestLanguage: () => 'auto' | 'vi' | 'en',
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
        this.cache = { transcripts: {}, translations: {}, summaries: {}, ...(JSON.parse(await readFile(this.cacheFile, 'utf8')) as Partial<Cache>) }
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

  private get gpuFile(): string {
    return join(app.getPath('userData'), 'ai-gpu.json')
  }

  private async voiceDevice(): Promise<'dml' | 'cpu'> {
    if (process.platform !== 'win32') return 'cpu'
    if (this.gpuBroken === undefined) {
      try {
        this.gpuBroken = (JSON.parse(await readFile(this.gpuFile, 'utf8')) as { broken?: boolean }).broken === true
      } catch {
        this.gpuBroken = false
      }
    }
    return this.gpuBroken ? 'cpu' : 'dml'
  }

  private markGpuBroken(): void {
    if (this.gpuBroken) return
    this.gpuBroken = true
    this.log('[ai] the GPU (DirectML) crashed the AI worker; voice notes now use the CPU')
    void writeFile(this.gpuFile, JSON.stringify({ broken: true, at: new Date().toISOString() })).catch(() => undefined)
  }

  async status(): Promise<AiStatus> {
    const model = this.voiceModel()
    return {
      voice: { model, ready: await present(AI_MODELS.voice[model]), gpu: (await this.voiceDevice()) === 'dml' },
      translate: { ready: await present(AI_MODELS.translate) },
      chat: { model: this.chatModel(), ready: await ggufPresent(modelsDir(), this.chatModel()) },
      speak: { vi: await present(AI_MODELS.speak.vi), en: await present(AI_MODELS.speak.en) },
      cutout: { ready: await present(AI_MODELS.cutout), native: nativeCutoutAvailable() },
      bytes: await folderSize(modelsDir())
    }
  }

  private spawn(): UtilityProcess {
    if (this.worker) return this.worker
    const worker = utilityProcess.fork(join(__dirname, 'ai-worker.js'), [], { serviceName: 'Moshi AI', stdio: 'pipe' })
    worker.stdout?.on('data', (d) => this.log('[ai]', String(d).trim()))
    worker.stderr?.on('data', (d) => this.log('[ai:err]', String(d).trim()))
    worker.on('message', (m: { type: string; id?: number; value?: unknown; message?: string } & Partial<AiProgress>) => {
      if (m.type === 'progress' && m.kind && m.phase) {
        if (m.error) this.log('[ai] failed:', m.error)
        this.onProgress({ kind: m.kind, phase: m.phase, progress: m.progress, error: m.error ? aiErrorHint(m.error, this.language()) : undefined })
      } else if (m.type === 'log') this.log('[ai]', m.message)
      else if ((m.type === 'result' || m.type === 'error') && m.id !== undefined) {
        const pending = this.pending.get(m.id)
        this.pending.delete(m.id)
        if (m.type === 'result') pending?.resolve(m.value)
        else pending?.reject(new Error(aiErrorHint(m.message ?? 'AI error', this.language())))
      }
    })
    worker.on('exit', () => {
      this.worker = undefined
      const pending = [...this.pending.values()]
      this.pending.clear()
      // A native crash while the GPU was in use: remember it and run those requests again on the CPU.
      const onGpu = pending.filter((p) => p.message.device === 'dml')
      if (onGpu.length) this.markGpuBroken()
      for (const p of pending) {
        if (p.message.device === 'dml' && !p.retried) {
          this.request({ ...p.message, device: 'cpu' }, true).then(p.resolve, p.reject)
        } else p.reject(new Error('The AI worker stopped'))
      }
    })
    worker.postMessage({ type: 'init', cacheDir: modelsDir() })
    this.worker = worker
    return worker
  }

  private request<T>(message: Record<string, unknown>, retried = false): Promise<T> {
    const worker = this.spawn()
    const id = this.nextId++
    if (this.idleTimer) clearTimeout(this.idleTimer)
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, message, retried })
      worker.postMessage({ ...message, id })
    }).finally(() => {
      if (this.idleTimer) clearTimeout(this.idleTimer)
      this.idleTimer = setTimeout(() => this.stop(), IDLE_MS)
    })
  }

  /** Whether the worker process is up. */
  running(): boolean {
    return !!this.worker
  }

  stop(): void {
    this.worker?.kill()
    this.worker = undefined
  }

  /**
   * Stop the worker and wait until it has really exited (an installer replacing Moshi finds it otherwise: a worker
   * with a model on the GPU takes a few seconds to let go of it). Forced after `timeoutMs`.
   */
  async stopAndWait(timeoutMs = 6_000): Promise<void> {
    const worker = this.worker
    this.worker = undefined
    if (!worker) return
    const pid = worker.pid
    const exited = new Promise<void>((resolve) => worker.once('exit', () => resolve()))
    worker.kill()
    const inTime = await Promise.race([exited.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), timeoutMs))])
    if (inTime || !pid) return
    this.log('[ai] the worker did not exit in time; ending it')
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* gone meanwhile */
    }
    await Promise.race([exited, new Promise((r) => setTimeout(r, 2_000))])
  }

  /** Download (first time) and load a model. */
  async prepare(kind: AiKind, speakLang?: SpeakLang): Promise<boolean> {
    return this.request<boolean>({
      type: 'prepare',
      kind,
      voiceModel: this.voiceModel(),
      chatModel: this.chatModel(),
      speakLang: speakLang ?? (this.language() === 'en' ? 'en' : 'vi'),
      device: kind === 'voice' ? await this.voiceDevice() : 'cpu'
    })
  }

  async remove(kind: AiKind): Promise<void> {
    this.stop()
    const repos =
      kind === 'voice'
        ? Object.values(AI_MODELS.voice).map((m) => m.repo)
        : kind === 'chat'
          ? // the GGUF folder, and the ONNX models earlier versions downloaded
            ['gguf', 'onnx-community/Qwen2.5-0.5B-Instruct', 'onnx-community/Qwen2.5-1.5B-Instruct']
          : kind === 'speak'
            ? Object.values(AI_MODELS.speak).map((m) => m.repo)
            : kind === 'cutout'
              ? [AI_MODELS.cutout.repo]
              : [AI_MODELS.translate.repo]
    for (const repo of repos) await rm(join(modelsDir(), ...repo.split('/')), { recursive: true, force: true })
  }

  private hardwareInfo: Promise<Hardware> | undefined

  /** GPU, its memory and the RAM, as llama.cpp sees them (asked once per run). */
  hardware(): Promise<Hardware> {
    this.hardwareInfo ??= this.request<Hardware>({ type: 'hardware' })
    this.hardwareInfo.catch(() => (this.hardwareInfo = undefined))
    return this.hardwareInfo
  }

  async transcribe(key: string, pcm: Float32Array, language?: string): Promise<string> {
    const cache = await this.cached()
    if (cache.transcripts[key] !== undefined) return cache.transcripts[key]
    const text = await this.request<string>({
      type: 'transcribe',
      voiceModel: this.voiceModel(),
      device: await this.voiceDevice(),
      audio: pcm,
      language: language ?? this.language()
    })
    this.remember('transcripts', key, text)
    return text
  }

  chat(messages: ReturnType<typeof summaryMessages>, maxNewTokens: number, schema?: unknown, options?: { voice?: boolean; temperature?: number }): Promise<string> {
    return this.request<string>({ type: 'chat', chatModel: this.chatModel(), messages, maxNewTokens, schema, options })
  }

  /** Where the personal voice for the current model lives (the training tool copies its result here). */
  voicePath(): string {
    return loraPath(modelsDir(), this.chatModel())
  }

  /** Use this trained voice for the current model. */
  async installVoice(file: string): Promise<void> {
    await mkdir(dirname(this.voicePath()), { recursive: true })
    await copyFile(file, this.voicePath())
  }

  /**
   * A personal voice is being trained on this computer (the tool leaves <model>.training beside the voices while it
   * runs). The GPU is then taken: the model is not loaded ahead and suggestions only come when asked for.
   */
  async training(): Promise<boolean> {
    const dir = dirname(this.voicePath())
    const files = await readdir(dir).catch(() => [] as string[])
    for (const name of files.filter((f) => f.endsWith('.training'))) {
      try {
        const { pid } = JSON.parse(await readFile(join(dir, name), 'utf8')) as { pid?: number }
        if (!pid) continue
        process.kill(pid, 0)
        return true
      } catch (err) {
        // EPERM: running, just not ours to signal; anything else: a lock left by a run that died
        if ((err as NodeJS.ErrnoException).code === 'EPERM') return true
      }
    }
    return false
  }

  async removeVoice(): Promise<void> {
    await rm(this.voicePath(), { force: true })
  }

  /** The personal voice for the current model: is there one, and did it load (an error when it did not fit). */
  voice(): Promise<{ present: boolean; error?: string }> {
    return this.request<{ present: boolean; error?: string }>({ type: 'voice', chatModel: this.chatModel() })
  }

  /** The model's answer as JSON, in the shape of the schema. */
  private async chatJson<T>(messages: ReturnType<typeof summaryMessages>, schema: unknown, maxNewTokens: number): Promise<T> {
    return parseJsonLoose<T>(await this.chat(messages, maxNewTokens, schema))
  }

  /** Load the language model in the background (a chat was opened), so the first suggestion is quick. */
  async warm(): Promise<void> {
    if (await this.training()) return
    if ((await this.status()).chat.ready) await this.request({ type: 'warm', chatModel: this.chatModel(), voice: this.voiceAllowed() }).catch(() => undefined)
  }

  /** What the replies are written in: the setting, or the language of the message being answered. */
  private replyLanguage(text: string): 'vi' | 'en' {
    const set = this.suggestLanguage()
    if (set !== 'auto') return set
    const found = detectLanguage(text)
    return found === 'vi' ? 'vi' : found === 'en' ? 'en' : this.language() === 'en' ? 'en' : 'vi'
  }

  /** The language most of these messages are in (vi or en), or the setting when it fixes one. */
  private chatLanguage(lines: ChatLine[]): 'vi' | 'en' {
    const set = this.suggestLanguage()
    if (set !== 'auto') return set
    let vi = 0
    let en = 0
    for (const l of lines) {
      const found = detectLanguage(l.text)
      if (found === 'vi') vi++
      else if (found === 'en') en++
    }
    return vi === en ? (this.language() === 'en' ? 'en' : 'vi') : vi > en ? 'vi' : 'en'
  }

  /** A few bullet points about these messages, cached by the newest one so reopening a chat is instant. */
  async summarize(key: string, lines: ChatLine[]): Promise<string[]> {
    const cache = await this.cached()
    // In the chat's own language (a Vietnamese chat summed up in English loses names, pronouns and detail), unless
    // the suggestions setting fixes one.
    const language = this.chatLanguage(lines)
    const cacheKey = `${key}|${language}|${this.chatModel()}`
    if (cache.summaries[cacheKey] !== undefined) return JSON.parse(cache.summaries[cacheKey]) as string[]
    const text = await askChat(this, summaryMessages(lines, language), 220)
    const bullets = parseSummary(text)
    if (bullets.length) this.remember('summaries', cacheKey, JSON.stringify(bullets))
    return bullets
  }

  /** Whether the BiRefNet cut-out model is downloaded. */
  cutoutModelReady(): Promise<boolean> {
    return present(AI_MODELS.cutout)
  }

  /** The photo with its background made transparent (PNG in, PNG out). */
  cutout(png: Uint8Array): Promise<Uint8Array> {
    return this.request<Uint8Array>({ type: 'cutout', image: png })
  }

  /** Audio for a text in one of the reading voices (16 kHz mono PCM). */
  speak(text: string, speakLang: SpeakLang): Promise<{ audio: Float32Array; rate: number }> {
    return this.request({ type: 'speak', speakLang, text })
  }

  /** Three short ways to answer the newest message. Not cached: the chat moves on. */
  async suggest(lines: ChatLine[], context: ChatContext = {}): Promise<string[]> {
    const answering = [...lines].reverse().find((l) => !l.mine)
    if (!answering) return []
    const replyLanguage = this.replyLanguage(answering.text)
    const examples = context.examples ?? (await this.examplesFor?.(lines, context, replyLanguage).catch((err: Error) => (this.log('[ai] examples failed:', err.message), []))) ?? []
    if (examples.length) this.log(`[ai] suggestions with ${examples.length} of the user's earlier replies as examples`)
    const result = await suggestReplies(
      lines,
      { context: { ...context, examples }, appLanguage: this.language(), replyLanguage, model: this.chatModel(), voice: this.voiceAllowed() && (await this.voice().catch(() => ({ present: false }))).present },
      (messages, schema, maxTokens, options) => this.chat(messages, maxTokens, schema, options),
      (...args) => this.log('[ai]', ...args)
    )
    return result.replies
  }

  /** Three ways to pick a quiet chat back up. Not cached either. */
  async opener(lines: ChatLine[], silentDays: number, note?: string, context: ChatContext = {}): Promise<string[]> {
    const language = this.replyLanguage(lines.map((l) => l.text).join(' ') || (this.language() === 'en' ? 'hello' : 'chào'))
    const ctx = { ...context, note: note ?? context.note }
    const address = detectAddress(lines)
    const text = await this.chat(openerWithContext(lines, this.language(), silentDays, language, ctx, address, styleOf(lines)), 160)
    return cleanReplies(splitReplies(text), { language, names: [ctx.me ?? ''], address })
  }

  /** Translate what the user typed into another language (for chatting with someone who reads it). */
  async translateTo(text: string, target: string): Promise<{ text: string; from: string; same?: boolean }> {
    const from = detectLanguage(text)
    if (from === target) return { text, from, same: true }
    const src = NLLB[from] ?? NLLB.en
    const tgt = NLLB[target] ?? NLLB.en
    const paragraphs = translationChunks(text)
    const parts = await this.request<string[]>({ type: 'translate', texts: paragraphs.flat(), src, tgt })
    let i = 0
    return { text: paragraphs.map((sentences) => sentences.map(() => parts[i++] ?? '').join(' ')).join('\n'), from }
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

/** What the chat model answers to a conversation; the text is trimmed by the worker. */
async function askChat(service: AiService, messages: ReturnType<typeof summaryMessages>, maxNewTokens: number): Promise<string> {
  return service.chat(messages, maxNewTokens)
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
  if (target.protocol === 'file:') {
    // Local voice notes are ones Moshi recorded or downloaded, inside its own folders; nothing else is read.
    if (!fileInside(target, [app.getPath('userData'), app.getPath('temp')])) throw new Error('This file cannot be read from here')
    return readFile(target)
  }
  if (target.protocol !== 'https:' || !MEDIA_HOSTS.test(target.hostname)) throw new Error('This media host is not allowed')
  const instagram = /instagram|cdninstagram/.test(target.hostname) || target.searchParams.has('_nc_cat')
  const ses = /fbcdn|cdninstagram|instagram|facebook|fbsbx/.test(target.hostname)
    ? session.fromPartition(partitionFor(instagram ? 'instagram' : 'messenger'))
    : session.defaultSession
  const res = await ses.fetch(target.toString(), { headers: { Referer: instagram ? 'https://www.instagram.com/' : 'https://www.facebook.com/' } })
  if (!res.ok) throw new Error(`Could not load the voice note (${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > 40 * 1024 * 1024) throw new Error('This voice note is too long')
  return buf
}
