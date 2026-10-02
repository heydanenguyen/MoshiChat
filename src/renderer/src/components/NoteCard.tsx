import { useEffect, useRef, useState } from 'react'
import { Lock, NotebookPen } from 'lucide-react'
import { givenName } from '@shared/extras'
import { useShownConversations, useStore, useT } from '../store'
import { formatAgo } from '../utils'

/** Starters for an empty note: each puts its lead-in on a new line and the cursor after it. */
const PROMPTS = [
  { emoji: '🎁', label: { vi: 'Sở thích', en: 'Likes' }, lead: { vi: 'Thích: ', en: 'Likes: ' } },
  { emoji: '🤝', label: { vi: 'Đã hứa', en: 'Promised' }, lead: { vi: 'Đã hứa: ', en: 'Promised: ' } },
  { emoji: '💬', label: { vi: 'Họ kể', en: 'Told me' }, lead: { vi: 'Kể: ', en: 'Told me: ' } },
  { emoji: '📅', label: { vi: 'Hẹn', en: 'Plans' }, lead: { vi: 'Hẹn: ', en: 'Plans: ' } }
] as const

/**
 * Your own notes about a person, in their details: what they told you, what you promised, what they like. A sticky
 * note on their profile: the card is the paper and you write straight on it. Saves itself as you type (and when you
 * leave the box); only on this account's settings, never sent anywhere. The reconnect card, birthday reminders and
 * the on-device opener read it back when it matters.
 */
export function NoteCard({ conversationId }: { conversationId: string }): JSX.Element {
  const t = useT()
  const language = useStore((s) => s.settings.language)
  const override = useStore((s) => s.settings.contactOverrides?.[conversationId])
  const title = useShownConversations()[conversationId]?.title ?? ''
  const setContactOverride = useStore((s) => s.setContactOverride)
  const [text, setText] = useState(override?.note ?? '')
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [focused, setFocused] = useState(false)
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
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`
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

  const write = (value: string): void => {
    setText(value)
    latest.current = value
    setState('idle')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void save(value), 800)
  }

  const start = (lead: string): void => {
    write(lead)
    requestAnimationFrame(() => {
      const el = box.current
      if (!el) return
      el.focus()
      el.setSelectionRange(lead.length, lead.length)
    })
  }

  const id = `note-${conversationId}`
  const status =
    state === 'saving' ? (
      t('noteSaving')
    ) : state === 'saved' && text ? (
      t('noteSaved')
    ) : override?.noteAt && text ? (
      formatAgo(override.noteAt, language)
    ) : (
      <>
        <Lock size={10} strokeWidth={2.6} aria-hidden /> {t('noteOnlyYou')}
      </>
    )
  return (
    <div className={`details-card note-card ${focused ? 'focused' : ''}`}>
      <label className="details-card-title note-title" htmlFor={id}>
        <NotebookPen size={12} strokeWidth={2.4} aria-hidden />
        {t('noteTitle')}
        <span className="note-state" aria-live="polite">
          {status}
        </span>
      </label>
      <textarea
        id={id}
        ref={box}
        className="note-input"
        rows={2}
        value={text}
        placeholder={t('notePlaceholderFor', { name: givenName(title) || title })}
        spellCheck={false}
        onChange={(e) => write(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          void save(text)
        }}
        onKeyDown={(e) => {
          // Esc leaves the box (and saves) instead of closing the pane.
          if (e.key === 'Escape') {
            e.stopPropagation()
            box.current?.blur()
          }
        }}
      />
      {!text && (
        <div className="note-prompts">
          {PROMPTS.map((p) => (
            // mousedown would blur the box first; the click writes the lead-in and puts the cursor after it
            <button key={p.lead.en} onMouseDown={(e) => e.preventDefault()} onClick={() => start(p.lead[language])}>
              <span aria-hidden>{p.emoji}</span>
              {p.label[language]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
