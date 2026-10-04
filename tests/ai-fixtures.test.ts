import { describe, expect, it } from 'vitest'
import { detectAddress, guessIntent } from '../src/shared/ai-context'
import type { ChatLine } from '../src/shared/ai-prompts'
import { FIXTURES } from './fixtures/ai-chats'

const linesOf = (rows: Array<[boolean, string]>, them = 'Họ'): ChatLine[] => rows.map(([mine, text], i) => ({ who: mine ? 'Tôi' : them, text, at: i * 60_000, mine }))

/** How often the on-device rules get pronouns and the kind of message right across the fixture chats. */
describe('rules over the fixture chats', () => {
  for (const f of FIXTURES) {
    it(f.id, () => {
      const lines = linesOf(f.lines, f.context.them)
      const address = detectAddress(lines)
      if (f.expect.self) expect(address.self, 'self').toBe(f.expect.self)
      if (f.expect.other) expect(address.other, 'other').toBe(f.expect.other)
      // an undecided rule is fine (the model classifies those); a wrong one is not
      const intent = guessIntent(lines.at(-1)!.text)
      if (intent !== undefined) expect(intent).toBe(f.expect.intent)
    })
  }
})
