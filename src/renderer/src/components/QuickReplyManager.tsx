import { useState } from 'react'
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import type { QuickReply } from '@shared/types'
import { useStore, useT } from '../store'
import { useQuickReplies } from './ComposerExtras'

/** Settings: add, edit and remove quick replies. */
export function QuickReplyManager(): JSX.Element {
  const t = useT()
  const replies = useQuickReplies()
  const setSettings = useStore((s) => s.setSettings)
  const [editing, setEditing] = useState<string | undefined>()
  const [shortcut, setShortcut] = useState('')
  const [text, setText] = useState('')

  const save = (list: QuickReply[]): void => void setSettings({ quickReplies: list })
  const begin = (r?: QuickReply): void => {
    setEditing(r?.id ?? 'new')
    setShortcut(r?.shortcut ?? '')
    setText(r?.text ?? '')
  }
  const clean = (s: string): string =>
    s
      .trim()
      .replace(/^\//, '')
      .replace(/\s+/g, '-')
      .slice(0, 24)
  const commit = (): void => {
    const sc = clean(shortcut)
    if (!sc || !text.trim()) return
    if (editing === 'new') save([...replies, { id: `qr-${Date.now().toString(36)}`, shortcut: sc, text: text.trim() }])
    else save(replies.map((r) => (r.id === editing ? { ...r, shortcut: sc, text: text.trim() } : r)))
    setEditing(undefined)
  }

  const editor = (
    <div className="qr-editor">
      <span className="qr-editor-shortcut">
        <span>/</span>
        <input className="field-input" value={shortcut} onChange={(e) => setShortcut(e.target.value)} placeholder={t('quickReplyShortcut')} autoFocus maxLength={25} />
      </span>
      <textarea className="field-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('quickReplyText')} rows={2} maxLength={1000} />
      <span className="qr-editor-actions">
        <button className="icon-btn" onClick={() => setEditing(undefined)} title={t('cancel')}>
          <X size={15} strokeWidth={2.4} />
        </button>
        <button className="btn primary" onClick={commit} disabled={!clean(shortcut) || !text.trim()}>
          <Check size={14} strokeWidth={2.6} /> {t('save')}
        </button>
      </span>
    </div>
  )

  return (
    <div className="qr-manager">
      {replies.map((r) =>
        editing === r.id ? (
          <div key={r.id}>{editor}</div>
        ) : (
          <div key={r.id} className="qr-row">
            <span className="qr-shortcut">/{r.shortcut}</span>
            <span className="qr-text">{r.text}</span>
            <button className="icon-btn" onClick={() => begin(r)} title={t('edit')}>
              <Pencil size={13} strokeWidth={2.3} />
            </button>
            <button className="icon-btn" onClick={() => save(replies.filter((x) => x.id !== r.id))} title={t('delete')}>
              <Trash2 size={13} strokeWidth={2.3} />
            </button>
          </div>
        )
      )}
      {editing === 'new' ? (
        editor
      ) : (
        <button className="qr-add" onClick={() => begin()}>
          <Plus size={14} strokeWidth={2.6} /> {t('quickReplyAdd')}
        </button>
      )}
    </div>
  )
}
