import { useEffect, useRef, useState } from 'react'
import { NotebookPen } from 'lucide-react'
import { useStore, useT } from '../store'
import { formatAgo } from '../utils'

/**
 * Your own notes about a person, in their details: what they told you, what you promised, what they like. Saves
 * itself as you type (and when you leave the box); only on this account's settings, never sent anywhere. The
 * reconnect card, birthday reminders and the on-device opener read it back when it matters.
 */
export function NoteCard({ conversationId }: { conversationId: string }): JSX.Element {
  const t = useT()
  const language = useStore((s) => s.settings.language)
  const override = useStore((s) => s.settings.contactOverrides?.[conversationId])
  const setContactOverride = useStore((s) => s.setContactOverride)
  const [text, setText] = useState(override?.note ?? '')
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const box = useRef<HTMLTextAreaElement>(null)
  const latest = useRef(text)

  // Another chat, or the note changed elsewhere (another computer): show what is stored.
  useEffect(() => {
    if (document.activeElement === box.current) return
    setText(override?.note ?? '')
    latest.current = override?.note ?? ''
  }, [conversationId, override?.note])

  // Grows with the text, up to a point (then it scrolls).
  useEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [text])

  const save = async (value: string): Promise<void> => {
    if (timer.current) clearTimeout(timer.current)
    const current = useStore.getState().settings.contactOverrides?.[conversationId]
    if ((current?.note ?? '') === value.trim() || (current?.note ?? '') === value) return
    setState('saving')
    await setContactOverride(conversationId, { ...current, note: value, noteAt: Date.now() })
    setState('saved')
  }

  useEffect(
    () => () => {
      // Leaving the chat mid-sentence still keeps it.
      if (timer.current) {
        clearTimeout(timer.current)
        void save(latest.current)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversationId]
  )

  const id = `note-${conversationId}`
  return (
    <div className="details-card note-card">
      <label className="details-card-title note-title" htmlFor={id}>
        <NotebookPen size={12} strokeWidth={2.4} aria-hidden />
        {t('noteTitle')}
        <span className="note-state" aria-live="polite">
          {state === 'saving' ? t('noteSaving') : state === 'saved' ? t('noteSaved') : override?.noteAt ? formatAgo(override.noteAt, language) : ''}
        </span>
      </label>
      <textarea
        id={id}
        ref={box}
        className="note-input"
        rows={2}
        value={text}
        placeholder={t('notePlaceholder')}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value)
          latest.current = e.target.value
          setState('idle')
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => void save(e.target.value), 800)
        }}
        onBlur={() => void save(text)}
        onKeyDown={(e) => {
          // Esc leaves the box (and saves) instead of closing the pane.
          if (e.key === 'Escape') {
            e.stopPropagation()
            box.current?.blur()
          }
        }}
      />
    </div>
  )
}
