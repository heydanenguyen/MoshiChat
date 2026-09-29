import { useEffect, useRef } from 'react'
import { Check, Languages, Sparkles } from 'lucide-react'
import { useStore, useT } from '../store'
import { useKeepInside } from '../popover'
import { LANGUAGE_NAMES } from './AiParts'

/** Languages offered for translating what you type, most used first. */
export const TRANSLATE_TARGETS = ['en', 'vi', 'zh', 'ja', 'ko', 'th', 'fr', 'de', 'es', 'id'] as const

export function languageName(code: string, language: 'vi' | 'en'): string {
  const entry = LANGUAGE_NAMES[code]
  return entry ? entry[language] : code.toUpperCase()
}

/**
 * Composer popover: pick a language, translate the draft now, and optionally have every message
 * to this person translated as it is sent (for chats with someone who reads another language).
 */
export function TranslatePicker({
  target,
  auto,
  busy,
  onTarget,
  onAuto,
  onTranslate,
  onClose
}: {
  target?: string
  auto: boolean
  busy: boolean
  onTarget(code: string): void
  onAuto(on: boolean): void
  onTranslate(): void
  onClose(): void
}): JSX.Element {
  const t = useT()
  const language = useStore((s) => s.settings.language)
  const ref = useRef<HTMLDivElement>(null)
  useKeepInside(ref)

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="schedule-picker translate-picker" ref={ref} role="dialog" aria-label={t('translateDraft')}>
      <div className="schedule-title">
        <Languages size={15} strokeWidth={2.3} />
        {t('translateTo')}
      </div>
      <div className="translate-langs">
        {TRANSLATE_TARGETS.map((code) => (
          <button key={code} className={`translate-lang ${target === code ? 'active' : ''}`} onClick={() => onTarget(code)}>
            {target === code && <Check size={12} strokeWidth={3} />}
            {languageName(code, language)}
          </button>
        ))}
      </div>
      <button className="btn primary translate-now" disabled={!target || busy} onClick={onTranslate}>
        <Sparkles size={14} strokeWidth={2.4} />
        {busy ? t('translateBusy') : t('translateNow')}
      </button>
      <label className={`translate-auto ${!target ? 'disabled' : ''}`}>
        <span className="translate-auto-text">
          <strong>{t('translateAuto')}</strong>
          <span>{target ? t('translateAutoHint', { lang: languageName(target, language) }) : t('translateAutoPick')}</span>
        </span>
        <button className={`switch ${auto ? 'on' : ''}`} role="switch" aria-checked={auto} disabled={!target} onClick={() => onAuto(!auto)} />
      </label>
    </div>
  )
}
