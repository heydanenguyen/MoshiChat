import { useEffect, useRef, useState } from 'react'
import { ArrowLeftRight, Plus, X } from 'lucide-react'
import type { CustomAccent, CustomAccentId } from '@shared/types'
import { accentVars, isHexColor } from '@shared/accent'
import { useStore, useT } from '../store'

const MAX_CUSTOM = 12

const fillOf = (a: { from: string; to?: string }): string => (a.to ? `linear-gradient(135deg, ${a.from}, ${a.to})` : a.from)

/** One colour stop: a swatch that opens the system colour picker, plus a hex field. */
function ColorField({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }): JSX.Element {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <label className="color-field">
      <span className="color-field-label">{label}</span>
      <span className="color-field-row">
        <span className="color-swatch" style={{ background: value }}>
          <input type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} aria-label={label} />
        </span>
        <input
          className="color-hex"
          value={text}
          spellCheck={false}
          maxLength={7}
          onChange={(e) => {
            const next = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`
            setText(next)
            if (isHexColor(next)) onChange(next.toUpperCase())
          }}
          onBlur={() => setText(value)}
        />
      </span>
    </label>
  )
}

/** Popover to build a custom accent, with a live mini-chat preview. */
function AccentEditor({ onClose }: { onClose(): void }): JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const [gradient, setGradient] = useState(true)
  const [from, setFrom] = useState('#FF5B1F')
  const [to, setTo] = useState('#9B5DE5')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const spec = gradient ? { from, to } : { from }
  const vars = accentVars(spec) as React.CSSProperties

  const save = async (): Promise<void> => {
    const accent: CustomAccent = { id: `custom-${Date.now().toString(36)}` as CustomAccentId, ...spec }
    await setSettings({ customAccents: [...(settings.customAccents ?? []), accent].slice(-MAX_CUSTOM), accent: accent.id })
    onClose()
  }

  return (
    <div className="accent-editor" ref={ref} role="dialog" aria-label={t('accentCustomNew')}>
      <div className="accent-editor-title">{t('accentCustomNew')}</div>
      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={!gradient} className={!gradient ? 'active' : ''} onClick={() => setGradient(false)}>
          {t('accentSolid')}
        </button>
        <button role="tab" aria-selected={gradient} className={gradient ? 'active' : ''} onClick={() => setGradient(true)}>
          {t('accentGradient')}
        </button>
      </div>
      <div className="accent-editor-fields">
        <ColorField label={gradient ? t('accentFrom') : t('accentColorLabel')} value={from} onChange={setFrom} />
        {gradient && (
          <>
            <button
              className="icon-btn accent-swap"
              title={t('accentSwap')}
              onClick={() => {
                setFrom(to)
                setTo(from)
              }}
            >
              <ArrowLeftRight size={15} strokeWidth={2.2} />
            </button>
            <ColorField label={t('accentTo')} value={to} onChange={setTo} />
          </>
        )}
      </div>
      <div className="accent-preview" style={vars}>
        <span className="accent-preview-in">{t('accentPreviewIn')}</span>
        <span className="accent-preview-out">{t('accentPreviewOut')}</span>
        <span className="accent-preview-row">
          <span className="accent-preview-btn">{t('send')}</span>
          <span className="accent-preview-badge">3</span>
          <span className="accent-preview-soft">{t('accentPreviewSoft')}</span>
        </span>
      </div>
      <div className="accent-editor-actions">
        <button className="btn secondary" onClick={onClose}>
          {t('cancel')}
        </button>
        <button className="btn primary" style={vars} onClick={() => void save()}>
          {t('accentSaveUse')}
        </button>
      </div>
    </div>
  )
}

/** "Yours" row in Settings: custom accents (click to use, × to remove) and a + to create one. */
export function CustomAccentRow(): JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const [editing, setEditing] = useState(false)
  const custom = settings.customAccents ?? []

  const remove = (id: CustomAccentId): void => {
    const next = custom.filter((a) => a.id !== id)
    void setSettings({ customAccents: next, ...(settings.accent === id ? { accent: 'ocean' as const } : {}) })
  }

  return (
    <>
      <div className="accent-group custom">
        <span className="accent-group-label">{t('accentCustom')}</span>
        <div className="accent-picker" role="radiogroup" aria-label={t('accentCustom')}>
          {custom.map((accent) => (
            <span key={accent.id} className="accent-custom-wrap">
              <button
                className={`accent-dot ${accent.to ? '' : 'flat'} ${settings.accent === accent.id ? 'active' : ''}`}
                role="radio"
                aria-checked={settings.accent === accent.id}
                onClick={() => void setSettings({ accent: accent.id })}
                title={accent.to ? `${accent.from} → ${accent.to}` : accent.from}
                style={{ background: fillOf(accent), ['--dot' as string]: accent.from } as React.CSSProperties}
              />
              <button className="accent-remove" onClick={() => remove(accent.id)} title={t('accentRemove')} aria-label={t('accentRemove')}>
                <X size={10} strokeWidth={3} />
              </button>
            </span>
          ))}
          {custom.length < MAX_CUSTOM && (
            <span className="accent-add-wrap">
              <button
                className={`accent-add ${editing ? 'active' : ''}`}
                onClick={() => setEditing((v) => !v)}
                title={t('accentCustomNew')}
                aria-expanded={editing}
              >
                <Plus size={14} strokeWidth={2.6} />
              </button>
            </span>
          )}
        </div>
      </div>
      {editing && <AccentEditor onClose={() => setEditing(false)} />}
    </>
  )
}
