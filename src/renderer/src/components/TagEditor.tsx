import { useState } from 'react'
import { Check, Plus, Trash2, X } from 'lucide-react'
import { TAG_COLORS, type TagMeta } from '@shared/types'
import { useStore, useT, useTagDefs } from '../store'

const EMOJI_IDEAS = ['🏷️', '🎓', '🏋️', '🎮', '✈️', '🍜', '💡', '🐶', '🎵', '📚', '💰', '🌸']

/** Inline form: emoji, name, colour. Calls onCreated with the new tag. */
export function TagCreator({ onCreated, onCancel, autoFocus = true }: { onCreated?(tag: TagMeta): void; onCancel?(): void; autoFocus?: boolean }): JSX.Element {
  const t = useT()
  const createTag = useStore((s) => s.createTag)
  const { list } = useTagDefs()
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState(EMOJI_IDEAS[0])
  // Start with a colour no tag uses yet, so new tags look distinct.
  const [color, setColor] = useState(() => TAG_COLORS.find((c) => !list.some((tag) => tag.color.toLowerCase() === c.toLowerCase())) ?? TAG_COLORS[0])
  const [busy, setBusy] = useState(false)
  const duplicate = list.some((tag) => tag.name.vi.toLowerCase() === name.trim().toLowerCase() || tag.name.en.toLowerCase() === name.trim().toLowerCase())
  const canSave = name.trim().length > 0 && !duplicate && !busy

  const save = async (): Promise<void> => {
    if (!canSave) return
    setBusy(true)
    try {
      const tag = await createTag({ name, emoji, color })
      setName('')
      onCreated?.(tag)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tag-creator" style={{ ['--tag' as string]: color } as React.CSSProperties}>
      <div className="tag-creator-row">
        <input
          className="tag-creator-emoji"
          value={emoji}
          onChange={(e) => setEmoji([...e.target.value].slice(-2).join(''))}
          aria-label={t('tagEmoji')}
          maxLength={4}
        />
        <input
          className="tag-creator-name"
          value={name}
          placeholder={t('tagNamePlaceholder')}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
            if (e.key === 'Escape') onCancel?.()
          }}
          maxLength={24}
          autoFocus={autoFocus}
          spellCheck={false}
        />
        <button className="tag-creator-save" onClick={() => void save()} disabled={!canSave} title={t('tagCreate')}>
          <Check size={15} strokeWidth={2.6} />
        </button>
        {onCancel && (
          <button className="icon-btn" onClick={onCancel} title={t('cancel')}>
            <X size={14} strokeWidth={2.4} />
          </button>
        )}
      </div>
      <div className="tag-creator-row wrap">
        {EMOJI_IDEAS.map((e) => (
          <button key={e} className={`tag-creator-pick ${e === emoji ? 'active' : ''}`} onClick={() => setEmoji(e)}>
            {e}
          </button>
        ))}
      </div>
      <div className="tag-creator-row wrap">
        {TAG_COLORS.map((c) => (
          <button key={c} className={`tag-creator-color ${c === color ? 'active' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
        ))}
      </div>
      {duplicate && <div className="tag-creator-hint">{t('tagExists')}</div>}
    </div>
  )
}

/** Every tag with a delete button (asks once), plus the creator. Used in Settings. */
export function TagManager(): JSX.Element {
  const t = useT()
  const { list } = useTagDefs()
  const deleteTag = useStore((s) => s.deleteTag)
  const tags = useStore((s) => s.settings.tags)
  const language = useStore((s) => s.settings.language)
  const [confirming, setConfirming] = useState<string | undefined>()
  const [adding, setAdding] = useState(false)
  const usage = (id: string): number => Object.values(tags).filter((list) => list.includes(id)).length

  return (
    <div className="tag-manager">
      {list.map((tag) => (
        <div key={tag.id} className="tag-manager-row">
          <span className="tag-swatch" style={{ background: tag.color }}>
            {tag.emoji}
          </span>
          <span className="tag-manager-name">{tag.name[language]}</span>
          <span className="tag-manager-count">{usage(tag.id) === 1 ? t('tagUsageOne') : t('tagUsage', { count: usage(tag.id) })}</span>
          {confirming === tag.id ? (
            <button
              className="btn danger small"
              onClick={() => {
                setConfirming(undefined)
                void deleteTag(tag.id)
              }}
              onBlur={() => setConfirming(undefined)}
              autoFocus
            >
              {t('tagDeleteConfirm')}
            </button>
          ) : (
            <button className="icon-btn" onClick={() => setConfirming(tag.id)} title={t('tagDelete')}>
              <Trash2 size={14} strokeWidth={2.2} />
            </button>
          )}
        </div>
      ))}
      {adding ? (
        <TagCreator onCreated={() => setAdding(false)} onCancel={() => setAdding(false)} />
      ) : (
        <button className="tag-manager-add" onClick={() => setAdding(true)}>
          <Plus size={14} strokeWidth={2.6} />
          {t('tagNew')}
        </button>
      )}
    </div>
  )
}
