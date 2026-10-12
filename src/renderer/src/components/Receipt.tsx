import type { MessageStatus } from '@shared/types'

/**
 * The delivery tick: one grey check once it is out, a second one drawn beside it (and both turning accent) when it is read.
 * The second stroke is always there, undrawn, so the change from delivered to read plays as a transition on the same element.
 * A message still sending has no tick (the text beside it says so).
 */
export function Receipt({ status, size = 18 }: { status: MessageStatus; size?: number }): JSX.Element | null {
  if (status === 'sending' || status === 'failed') return null
  return (
    <svg className={`receipt ${status === 'read' ? 'read' : ''}`} width={size} height={(size * 12) / 18} viewBox="0 0 18 12" aria-hidden focusable="false">
      <path className="receipt-a" d="M1.8 6.6 5 9.8 11.6 2.6" />
      <path className="receipt-b" d="M8.2 9.8 14.8 2.6" />
    </svg>
  )
}
