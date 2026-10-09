/** How close to the bottom (px) the view must be for the thread to pin itself to the newest message again. */
export const NEAR_BOTTOM_PX = 80

export interface PinInput {
  pinned: boolean
  /** scrollHeight - scrollTop - clientHeight, after this scroll event. */
  distanceFromBottom: number
  /** The same distance before this scroll event. */
  prevDistanceFromBottom: number
  /** Whether the person caused this scroll (wheel, touch, key, scrollbar drag) rather than a layout change. */
  userInput: boolean
}

/**
 * Whether the thread should keep following the newest message after a scroll.
 *
 * The person scrolling up is the only thing that unpins, and it does so at once: waiting until they were 80px away
 * meant every row that entered the view in that band snapped them back to the bottom. Rows growing on their own
 * (a photo loading) move the bottom away without the person doing anything, so that keeps the pin. Scrolling back
 * down into the band, or any jump that lands at the bottom, pins again.
 */
export function nextPinned({ pinned, distanceFromBottom, prevDistanceFromBottom, userInput }: PinInput): boolean {
  const movedUp = distanceFromBottom > prevDistanceFromBottom
  if (userInput && movedUp) return false
  if (distanceFromBottom < NEAR_BOTTOM_PX) return true
  if (!userInput) return pinned
  return false
}
