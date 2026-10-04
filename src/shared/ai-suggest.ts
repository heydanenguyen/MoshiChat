/**
 * Reply suggestions, end to end: work out the pronouns, the user's style and the kind of message on the device,
 * ask the model for three replies (one a line; a JSON grammar garbles small models that want to think first), keep the usable ones and fill the rest from ready-made
 * replies. The model call is passed in, so the app and the evaluation run the very same steps.
 */
import type { ChatModel } from './ai'
import { cleanReplies, detectAddress, guessIntent, replyBank, styleOf, type Address, type ChatContext, type Intent, type Style } from './ai-context'
import { INTENT_SCHEMA, classifyMessages, parseJsonLoose, replyMessages, splitReplies, voiceMessages, type ChatLine, type ChatMessage } from './ai-prompts'

/** One call to the model: messages in, the raw text out (JSON when a schema is given). */
export type Ask = (messages: ChatMessage[], schema: unknown, maxTokens: number, options?: { voice?: boolean; temperature?: number }) => Promise<string>

export interface SuggestResult {
  replies: string[]
  intent: Intent
  /** Where the kind of message came from. */
  intentBy: 'rules' | 'model' | 'default'
  address: Address
  style: Style
  /** What the model wrote and survived the checks (before ready-made replies filled in). */
  written: string[]
}

export async function suggestReplies(
  lines: ChatLine[],
  /** voice: the user has a personal voice (a LoRA trained on their replies) for this model. */
  options: { context: ChatContext; appLanguage: string; replyLanguage: 'vi' | 'en'; model: ChatModel; voice?: boolean },
  ask: Ask,
  log: (...args: unknown[]) => void = () => undefined
): Promise<SuggestResult> {
  const answering = [...lines].reverse().find((l) => !l.mine)
  const address = detectAddress(lines)
  // the user's earlier replies count towards their style too (they are often more than this chat shows)
  const style = styleOf([...(options.context.examples ?? []).map((e) => ({ who: 'Tôi', text: e.me, at: 0, mine: true })), ...lines])
  if (!answering) return { replies: [], intent: 'info', intentBy: 'default', address, style, written: [] }
  const language = options.replyLanguage
  let intent: Intent | undefined = guessIntent(answering.text)
  let intentBy: SuggestResult['intentBy'] = intent ? 'rules' : 'default'
  if (!intent && options.model !== 'qwen35-0.8b') {
    intent = await ask(classifyMessages(answering.text), INTENT_SCHEMA, 20)
      .then((text) => parseJsonLoose<{ intent?: Intent }>(text).intent)
      .catch(() => undefined)
    if (intent) intentBy = 'model'
  }
  intent ??= 'info'
  const ready = replyBank(intent, address, language)
  const clean = { language, answering: answering.text, names: [options.context.me ?? '', answering.who], address }
  let written: string[] = []
  // The personal voice writes one reply per call, in the format it was trained on; three calls, sampled freely.
  if (options.voice) {
    try {
      const drafts: string[] = []
      // up to five tries for three that start differently ("con về nha mẹ, …" three times is one suggestion)
      const opening = (text: string): string => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 3).join(' ')
      for (let i = 0; i < 5 && drafts.length < 3; i++) {
        const draft = splitReplies(await ask(voiceMessages(lines), undefined, 60, { voice: true, temperature: 1 }))[0] ?? ''
        if (draft && !drafts.some((d) => opening(d) === opening(draft))) drafts.push(draft)
      }
      written = cleanReplies(drafts, clean)
    } catch (err) {
      log('personal voice failed:', (err as Error).message)
    }
    if (written.length >= 2) return { replies: cleanReplies([...written, ...ready], { language, answering: answering.text }), intent, intentBy, address, style, written }
  }
  // The smallest model cannot write well: it only picks the kind of message, the replies come ready-made.
  if (options.model === 'qwen35-0.8b') return { replies: cleanReplies([...written, ...ready], { language, answering: answering.text }), intent, intentBy, address, style, written }
  try {
    const text = await ask(replyMessages(lines, options.appLanguage, language, options.context, address, style, intent), undefined, 160)
    written = cleanReplies([...written, ...splitReplies(text)], clean)
  } catch (err) {
    log('reply suggestions failed:', (err as Error).message)
  }
  // Anything the model got wrong is filled from the ready-made replies.
  return { replies: cleanReplies([...written, ...ready], { language, answering: answering.text }), intent, intentBy, address, style, written }
}
