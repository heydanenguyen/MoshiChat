import { useEffect, useState } from 'react'
import type { GifProvider } from '@shared/types'
import { useStore } from './store'

// Asked once per session: the release's built-in key never changes while the app runs.
let builtIn: Promise<GifProvider | null> | undefined
// The answer, once it came: later pickers start with it (no loader flash on every open).
let known: GifProvider | null | undefined

/**
 * Which GIF keys are at hand: one pasted in Settings, or the one built into the release (asked from main).
 * `gif`: the GIF picker can search; `giphy`: a GIPHY key for stickers; `own`: the user's own GIF key (a refused
 * one means it is wrong); `checked`: the built-in key has been asked about (until then, no "set up a key" screen).
 */
export function useGifKeyState(): { gif: boolean; giphy: boolean; own: boolean; checked: boolean } {
  const own = useStore((s) => !!s.settings.gif?.key?.trim())
  const ownGiphy = useStore((s) => (s.settings.gif?.provider === 'giphy' && !!s.settings.gif.key?.trim()) || !!s.settings.giphyKey?.trim())
  const [shipped, setShipped] = useState<GifProvider | null | undefined>(known)
  useEffect(() => {
    if (known !== undefined) return
    let live = true
    builtIn ??= window.unison.app
      .gifDefault()
      .catch(() => null)
      .then((p) => (known = p))
    void builtIn.then((p) => live && setShipped(p))
    return () => {
      live = false
    }
  }, [])
  return { gif: own || !!shipped, giphy: ownGiphy || shipped === 'giphy', own, checked: shipped !== undefined }
}
