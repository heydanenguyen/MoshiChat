/**
 * The language model, run by llama.cpp (node-llama-cpp) inside the AI worker: on the GPU when the machine has one
 * (Metal on Apple chips, Vulkan on Windows for NVIDIA, AMD and Intel alike), else on the CPU. GGUF models are
 * downloaded once into <models>/gguf. One model stays loaded at a time; the worker exits when idle.
 *
 * A personal voice (a LoRA the user trained on their own replies, in <models>/lora/<model>.gguf) gets a second
 * context on the same model, so only reply suggestions go through it; summaries and the rest keep the plain model.
 */
import { stat } from 'fs/promises'
import { totalmem } from 'os'
import { join } from 'path'
import { AI_MODELS, type ChatModel, type Hardware } from '@shared/ai'
import type { ChatMessage } from '@shared/ai-prompts'

type Lib = typeof import('node-llama-cpp')
type Llama = Awaited<ReturnType<Lib['getLlama']>>
type Model = Awaited<ReturnType<Llama['loadModel']>>
type Context = Awaited<ReturnType<Model['createContext']>>

let lib: Lib | undefined
let llamaPromise: Promise<Llama> | undefined
type Sequence = ReturnType<Context['getSequence']>
let loaded:
  | { id: ChatModel; model: Model; context: Context; sequence: Sequence; voice?: { context: Context; sequence: Sequence; mtime: number } }
  | undefined
/** Why the personal voice could not be used (a LoRA for another model, a damaged file). */
let voiceError: string | undefined
let loading: Promise<NonNullable<typeof loaded>> | undefined

async function library(): Promise<Lib> {
  lib ??= await import('node-llama-cpp')
  return lib
}

/** llama.cpp with the best backend this machine has; never compiles anything at runtime. */
function llama(): Promise<Llama> {
  llamaPromise ??= library().then((l) => l.getLlama({ gpu: 'auto', build: 'never', progressLogs: false, logLevel: l.LlamaLogLevel.error }))
  llamaPromise.catch(() => (llamaPromise = undefined))
  return llamaPromise
}

export const ggufPath = (dir: string, id: ChatModel): string => join(dir, 'gguf', AI_MODELS.chat[id].file)

export const loraPath = (dir: string, id: ChatModel): string => join(dir, 'lora', `${id}.gguf`)

/** The personal voice for this model: whether there is one and whether it loaded. */
export async function voiceState(dir: string, id: ChatModel): Promise<{ present: boolean; error?: string }> {
  const info = await stat(loraPath(dir, id)).catch(() => undefined)
  return { present: !!info, error: info && loaded?.id === id && !loaded.voice ? voiceError : undefined }
}

export async function ggufPresent(dir: string, id: ChatModel): Promise<boolean> {
  const info = await stat(ggufPath(dir, id)).catch(() => undefined)
  return !!info && info.size >= AI_MODELS.chat[id].megabytes * 0.9 * 1024 * 1024
}

export async function hardware(): Promise<Hardware> {
  const ramGb = totalmem() / 2 ** 30
  const unified = process.platform === 'darwin' && process.arch === 'arm64'
  try {
    const l = await llama()
    if (!l.gpu) return { gpu: false, vramGb: 0, ramGb, unified }
    const vram = await l.getVramState()
    const names = await l.getGpuDeviceNames().catch(() => [] as string[])
    return { gpu: l.gpu, gpuName: names[0], vramGb: vram.total / 2 ** 30, ramGb, unified }
  } catch {
    return { gpu: false, vramGb: 0, ramGb, unified }
  }
}

/** Download the model (first time, resuming a broken download), reporting progress 0..1. */
export async function download(dir: string, id: ChatModel, onProgress: (fraction: number) => void): Promise<void> {
  if (await ggufPresent(dir, id)) return
  const { createModelDownloader } = await library()
  const spec = AI_MODELS.chat[id]
  const downloader = await createModelDownloader({
    modelUri: `https://huggingface.co/${spec.repo}/resolve/main/${spec.file}`,
    dirPath: join(dir, 'gguf'),
    fileName: spec.file,
    showCliProgress: false,
    onProgress: ({ downloadedSize, totalSize }) => onProgress(totalSize ? downloadedSize / totalSize : 0)
  })
  await downloader.download()
}

/** Load the model now if it is downloaded (and the personal voice, if any), so the first suggestion does not wait. */
export async function warm(dir: string, id: ChatModel, voice = false): Promise<void> {
  if (!(await ggufPresent(dir, id))) return
  const ready = await ensure(dir, id)
  // in the queue: it may replace the voice context an answer is using
  if (voice) await (queue = queue.then(() => voiceSequence(dir, ready)).catch(() => undefined))
}

/** The model loaded and ready (loading it, or swapping out another, when needed). */
export async function load(dir: string, id: ChatModel): Promise<{ gpu: boolean }> {
  const ready = await ensure(dir, id)
  return { gpu: ready.model.gpuLayers > 0 }
}

async function ensure(dir: string, id: ChatModel): Promise<NonNullable<typeof loaded>> {
  if (loaded?.id === id) return loaded
  if (loading) {
    const current = await loading.catch(() => undefined)
    if (current?.id === id) return current
  }
  loading = (async () => {
    if (loaded) {
      const old = loaded
      loaded = undefined
      await old.context.dispose().catch(() => undefined)
      await old.model.dispose().catch(() => undefined)
    }
    const l = await llama()
    const model = await l.loadModel({ modelPath: ggufPath(dir, id) })
    const context = await model.createContext({ contextSize: 4096 })
    loaded = { id, model, context, sequence: context.getSequence() }
    return loaded
  })()
  try {
    return await loading
  } finally {
    loading = undefined
  }
}

/**
 * The context with the personal voice on it, made when first asked for and again when the file changes (a new
 * training). Undefined when there is none or it does not fit the model; the reason is kept for the settings.
 */
async function voiceSequence(dir: string, ready: NonNullable<typeof loaded>): Promise<Sequence | undefined> {
  const info = await stat(loraPath(dir, ready.id)).catch(() => undefined)
  if (!info) {
    if (ready.voice) await ready.voice.context.dispose().catch(() => undefined)
    ready.voice = undefined
    return undefined
  }
  if (ready.voice?.mtime === info.mtimeMs) return ready.voice.sequence
  if (ready.voice) await ready.voice.context.dispose().catch(() => undefined)
  ready.voice = undefined
  try {
    const context = await ready.model.createContext({ contextSize: 2048, lora: { adapters: [{ filePath: loraPath(dir, ready.id), scale: 1 }] } })
    ready.voice = { context, sequence: context.getSequence(), mtime: info.mtimeMs }
    voiceError = undefined
    return ready.voice.sequence
  } catch (err) {
    voiceError = (err as Error).message
    return undefined
  }
}

export interface ChatOptions {
  /** Answer in the user's personal voice when they have one. */
  voice?: boolean
  temperature?: number
}

/**
 * One answer at a time: two requests at once (a suggestion the app asked for while another runs) would share the
 * sequence, one clearing it while the other decodes ("inconsistent sequence positions", "Eval has failed").
 */
let queue: Promise<unknown> = Promise.resolve()

/** One answer to a conversation of system / user / assistant messages, its thinking switched off. */
export function chat(dir: string, id: ChatModel, messages: ChatMessage[], maxTokens: number, schema?: unknown, options: ChatOptions = {}): Promise<string> {
  const run = queue.then(() => answer(dir, id, messages, maxTokens, schema, options))
  queue = run.catch(() => undefined)
  return run
}

async function answer(dir: string, id: ChatModel, messages: ChatMessage[], maxTokens: number, schema: unknown, options: ChatOptions): Promise<string> {
  const { LlamaChatSession } = await library()
  const ready = await ensure(dir, id)
  const sequence = (options.voice && (await voiceSequence(dir, ready))) || ready.sequence
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const turns = messages.filter((m) => m.role !== 'system')
  const last = turns.at(-1)
  if (!last || last.role !== 'user') throw new Error('The conversation must end with a user message')
  await sequence.clearHistory()
  const session = new LlamaChatSession({ contextSequence: sequence, systemPrompt: system || undefined, autoDisposeSequence: false })
  try {
    // Earlier turns (few-shot examples) go in as history.
    if (turns.length > 1) {
      session.setChatHistory([
        ...(system ? [{ type: 'system' as const, text: system }] : []),
        ...turns.slice(0, -1).map((m) => (m.role === 'user' ? { type: 'user' as const, text: m.content } : { type: 'model' as const, response: [m.content] }))
      ])
    }
    // A JSON schema keeps the answer in shape (three replies, one intent…): llama.cpp only samples tokens that fit it.
    const grammar = schema ? await (await llama()).createGrammarForJsonSchema(schema as never) : undefined
    const text = await session.prompt(last.content, {
      maxTokens,
      ...(grammar ? { grammar } : {}),
      temperature: options.temperature ?? 0.6,
      topP: 0.9,
      repeatPenalty: { penalty: 1.08 },
      budgets: { thoughtTokens: 0 }
    })
    return text.trim()
  } finally {
    session.dispose({ disposeSequence: false })
  }
}
