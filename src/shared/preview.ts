import type { Message, PreviewKind } from './types'

/** What the conversation list should label a message as, when it is not plain text. */
export const previewKindOf = (message: Message): PreviewKind | undefined => {
  if (message.unsent) return 'unsent'
  if (message.system) {
    if (message.system.kind === 'call' || message.system.kind === 'missed_call') return 'call'
    if (message.system.kind === 'unavailable') return 'unavailable'
    return undefined
  }
  const first = message.attachments[0]
  switch (first?.kind) {
    case undefined:
      return undefined
    case 'image':
      return first.name === 'GIF' ? 'gif' : 'photo'
    case 'video':
      return 'video'
    case 'audio':
      return 'voice'
    case 'sticker':
      return 'sticker'
    case 'link':
      return message.text ? undefined : 'link'
    case 'post':
      return first.reel ? 'reel' : 'post'
    case 'story':
      return first.label ?? 'story_share'
    default:
      return 'file'
  }
}
