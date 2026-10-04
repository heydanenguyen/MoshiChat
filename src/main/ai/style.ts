import type { ChatLine } from '@shared/ai-prompts'
import { detectAddress, type ChatContext } from '@shared/ai-context'
import { pickExamples, stylePairs, trainingSamples, type StyleExample, type StylePair, type TrainingSample } from '@shared/ai-style'
import type { InsightRecord } from '@shared/insights'
import type { Conversation, Settings } from '@shared/types'

/** Rebuild the pairs at most this often; new messages are a small share of them. */
const FRESH_MS = 5 * 60_000

/**
 * The user's earlier replies, for reply suggestions in their own voice and for a personal LoRA. Works from the
 * insight records already on disk; keeps the pairs in memory only.
 */
export class StyleMemory {
  private pairs: StylePair[] = []
  private builtAt = 0
  private building: Promise<StylePair[]> | undefined

  constructor(
    private readonly records: () => Promise<InsightRecord[]>,
    private readonly conversations: () => Conversation[],
    private readonly settings: () => Settings
  ) {}

  /** Chats left out: groups (whose "before" is anyone) and chats with a tag the user excluded. */
  private skip(): (conversationId: string) => boolean {
    const s = this.settings()
    const groups = new Set(this.conversations().filter((c) => c.isGroup).map((c) => c.id))
    const excluded = new Set(s.aiStyleSkipTags ?? [])
    return (id) => groups.has(id) || (excluded.size > 0 && (s.tags?.[id] ?? []).some((t) => excluded.has(t)))
  }

  private async all(): Promise<StylePair[]> {
    if (Date.now() - this.builtAt < FRESH_MS) return this.pairs
    this.building ??= this.records()
      .then((records) => {
        this.pairs = stylePairs(records, this.skip())
        this.builtAt = Date.now()
        return this.pairs
      })
      .finally(() => (this.building = undefined))
    return this.building
  }

  /** Forget the pairs (settings changed): the next suggestion rebuilds them. */
  invalidate(): void {
    this.builtAt = 0
  }

  async examples(lines: ChatLine[], context: ChatContext, language: 'vi' | 'en'): Promise<StyleExample[]> {
    const s = this.settings()
    if (s.aiStyleExamples === false || context.isGroup) return []
    const answering = [...lines].reverse().find((l) => !l.mine)
    if (!answering) return []
    const pairs = await this.all()
    const id = context.conversationId
    return pickExamples(pairs, {
      answering: answering.text,
      conversationId: id,
      language,
      address: detectAddress(lines),
      tags: id ? (s.tags?.[id] ?? []) : [],
      tagsOf: (other) => s.tags?.[other] ?? []
    })
  }

  /** Everything a personal LoRA is trained on (never includes excluded or group chats). */
  async samples(): Promise<TrainingSample[]> {
    return trainingSamples(await this.records(), this.skip())
  }

  async count(): Promise<number> {
    return (await this.all()).length
  }
}
