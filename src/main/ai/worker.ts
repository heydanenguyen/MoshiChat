/**
 * On-device AI worker, run as an Electron utility process (its own process, so the app never stalls).
 * Loads transformers.js pipelines lazily: Whisper for voice notes, NLLB for translation. The service
 * picks the device per request: Whisper runs on the GPU through DirectML when the machine can,
 * NLLB always on the CPU (its int8 model crashes DirectML natively). Models are downloaded once from
 * Hugging Face into <userData>/models.
 */
import { AI_MODELS, type AiKind, type ChatModel, type SpeakLang, type VoiceModel } from '@shared/ai'
import type { ChatMessage } from '@shared/ai-prompts'

export type Device = 'dml' | 'cpu'

type Request =
  | { type: 'init'; cacheDir: string }
  | { type: 'prepare'; id: number; kind: AiKind; voiceModel: VoiceModel; chatModel: ChatModel; speakLang: SpeakLang; device: Device }
  | { type: 'speak'; id: number; speakLang: SpeakLang; text: string }
  | { type: 'cutout'; id: number; image: Uint8Array }
  | { type: 'chat'; id: number; chatModel: ChatModel; messages: ChatMessage[]; maxNewTokens: number }
  | { type: 'transcribe'; id: number; voiceModel: VoiceModel; device: Device; audio: Float32Array; language?: string }
  | { type: 'translate'; id: number; texts: string[]; src: string; tgt: string }

type Pipe = (input: unknown, options?: Record<string, unknown>) => Promise<unknown>

const port = (process as unknown as { parentPort: { on(e: 'message', cb: (e: { data: Request }) => void): void; postMessage(m: unknown): void } }).parentPort
const send = (message: unknown): void => port.postMessage(message)

let transformers: typeof import('@huggingface/transformers') | undefined
const pipes = new Map<string, Promise<Pipe>>()

async function lib(cacheDir?: string): Promise<typeof import('@huggingface/transformers')> {
  if (!transformers) {
    transformers = await import('@huggingface/transformers')
    transformers.env.allowLocalModels = false
    transformers.env.useFSCache = true
  }
  if (cacheDir) transformers.env.cacheDir = cacheDir
  return transformers
}

/** Build (or reuse) a pipeline, reporting download progress for this kind of model. */
function pipe(kind: AiKind, voiceModel: VoiceModel, device: Device, chatModel: ChatModel = 'small', speakLang: SpeakLang = 'vi'): Promise<Pipe> {
  const spec = kind === 'voice' ? AI_MODELS.voice[voiceModel] : kind === 'chat' ? AI_MODELS.chat[chatModel] : kind === 'speak' ? AI_MODELS.speak[speakLang] : kind === 'cutout' ? AI_MODELS.cutout : AI_MODELS.translate
  const key = `${spec.repo}|${device}`
  const existing = pipes.get(key)
  if (existing) return existing
  const task = kind === 'voice' ? 'automatic-speech-recognition' : kind === 'chat' ? 'text-generation' : kind === 'speak' ? 'text-to-speech' : kind === 'cutout' ? 'background-removal' : 'translation'
  const files = new Map<string, { loaded: number; total: number }>()
  const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }): void => {
    if (p.status === 'progress' && p.file) {
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 })
      let loaded = 0
      let total = 0
      for (const f of files.values()) {
        loaded += f.loaded
        total += f.total
      }
      send({ type: 'progress', kind, phase: 'downloading', progress: total ? loaded / total : 0 })
    }
  }
  const load = async (): Promise<Pipe> => {
    const { pipeline } = await lib()
    // The service is told before a GPU load starts: if DirectML crashes the process, it knows why.
    if (device === 'dml') send({ type: 'gpu-load', kind })
    const result = (await pipeline(task as never, spec.repo, { dtype: spec.dtype as never, device, progress_callback } as never)) as unknown as Pipe
    if (device === 'dml') send({ type: 'gpu-ok', kind })
    send({ type: 'progress', kind, phase: 'ready', progress: 1 })
    return result
  }
  const promise = load()
  pipes.set(key, promise)
  promise.catch(() => pipes.delete(key))
  return promise
}

port.on('message', async ({ data }) => {
  const request = data
  try {
    if (request.type === 'init') {
      await lib(request.cacheDir)
      return
    }
    if (request.type === 'prepare') {
      send({ type: 'progress', kind: request.kind, phase: 'loading' })
      await pipe(request.kind, request.voiceModel, request.kind === 'voice' ? request.device : 'cpu', request.chatModel, request.speakLang)
      send({ type: 'result', id: request.id, value: true })
      return
    }
    if (request.type === 'transcribe') {
      const asr = await pipe('voice', request.voiceModel, request.device)
      const audio = request.audio instanceof Float32Array ? request.audio : new Float32Array(request.audio as ArrayLike<number>)
      const output = (await asr(audio, {
        task: 'transcribe',
        ...(request.language ? { language: request.language } : {}),
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: false
      })) as { text?: string } | Array<{ text?: string }>
      const text = (Array.isArray(output) ? output.map((o) => o.text ?? '').join(' ') : (output.text ?? '')).trim()
      send({ type: 'result', id: request.id, value: text })
      return
    }
    if (request.type === 'cutout') {
      const { RawImage } = await lib()
      const remove = await pipe('cutout', 'turbo', 'cpu')
      const image = await RawImage.fromBlob(new Blob([Uint8Array.from(request.image) as never]))
      type Cut = { toSharp(): import('sharp').Sharp }
      const result = (await remove(image)) as Cut | Cut[]
      const cut = Array.isArray(result) ? result[0] : result
      const png = await cut.toSharp().png().toBuffer()
      send({ type: 'result', id: request.id, value: new Uint8Array(png) })
      return
    }
    if (request.type === 'speak') {
      const tts = await pipe('speak', 'turbo', 'cpu', 'small', request.speakLang)
      const out = (await tts(request.text)) as { audio: Float32Array; sampling_rate: number }
      send({ type: 'result', id: request.id, value: { audio: out.audio, rate: out.sampling_rate } })
      return
    }
    if (request.type === 'chat') {
      const generate = await pipe('chat', 'turbo', 'cpu', request.chatModel)
      const output = (await generate(request.messages, {
        max_new_tokens: request.maxNewTokens,
        do_sample: false,
        repetition_penalty: 1.1,
        return_full_text: false
      })) as Array<{ generated_text?: string | ChatMessage[] }>
      const generated = output[0]?.generated_text
      const text = typeof generated === 'string' ? generated : (generated?.at(-1)?.content ?? '')
      send({ type: 'result', id: request.id, value: text.trim() })
      return
    }
    if (request.type === 'translate') {
      const translator = await pipe('translate', 'turbo', 'cpu')
      const out: string[] = []
      for (const text of request.texts) {
        const result = (await translator(text, { src_lang: request.src, tgt_lang: request.tgt, max_new_tokens: 512 })) as Array<{ translation_text?: string }>
        out.push((result[0]?.translation_text ?? '').trim())
      }
      send({ type: 'result', id: request.id, value: out })
      return
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Loading the library itself can fail (a build packaged for another CPU): say so in the log at least.
    if (request.type === 'init') send({ type: 'log', message: `could not load the AI library: ${message}` })
    if ('kind' in request) send({ type: 'progress', kind: request.kind, phase: 'error', error: message })
    if ('id' in request) send({ type: 'error', id: request.id, message })
  }
})
