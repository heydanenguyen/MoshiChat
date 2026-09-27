import { AlertCircle, AudioLines, Captions, Cpu, Languages, ShieldCheck, Trash2, X } from 'lucide-react'
import { AI_MODELS, type AiKind, type VoiceModel } from '@shared/ai'
import type { Attachment, Message } from '@shared/types'
import { textKey, useAi, voiceKey } from '../aiStore'
import { useStore, useT } from '../store'
import { formatBytes } from '../utils'
import { BuddyLoader } from './BuddyLoader'
import { LogoMark } from './Logo'

const LANGUAGE_NAMES: Record<string, { vi: string; en: string }> = {
  vi: { vi: 'tiếng Việt', en: 'Vietnamese' },
  en: { vi: 'tiếng Anh', en: 'English' },
  zh: { vi: 'tiếng Trung', en: 'Chinese' },
  ja: { vi: 'tiếng Nhật', en: 'Japanese' },
  ko: { vi: 'tiếng Hàn', en: 'Korean' },
  th: { vi: 'tiếng Thái', en: 'Thai' },
  ru: { vi: 'tiếng Nga', en: 'Russian' },
  fr: { vi: 'tiếng Pháp', en: 'French' },
  de: { vi: 'tiếng Đức', en: 'German' },
  es: { vi: 'tiếng Tây Ban Nha', en: 'Spanish' },
  id: { vi: 'tiếng Indonesia', en: 'Indonesian' },
  lo: { vi: 'tiếng Lào', en: 'Lao' },
  km: { vi: 'tiếng Khmer', en: 'Khmer' }
}

/** Under a voice note: "Convert to text", then the transcript. */
export function VoiceTranscript({ message, attachment }: { message: Message; attachment: Attachment }): JSX.Element {
  const t = useT()
  const result = useAi((s) => s.results[voiceKey(message, attachment)])
  const transcribe = useAi((s) => s.transcribe)
  if (!result || (!result.text && !result.busy && !result.error)) {
    return (
      <button className="ai-chip" onClick={() => void transcribe(message, attachment)} title={t('aiTranscribeHint')}>
        <Captions size={13} strokeWidth={2.3} /> {t('aiTranscribe')}
      </button>
    )
  }
  if (result.busy) {
    return (
      <div className="ai-note busy">
        <BuddyLoader size={16} inline /> {t('aiListening')}
      </div>
    )
  }
  if (result.error) {
    return (
      <button className="ai-note error" onClick={() => void transcribe(message, attachment)} title={t('retry')}>
        <AlertCircle size={13} strokeWidth={2.3} /> {result.error}
      </button>
    )
  }
  return (
    <div className="ai-note transcript">
      <AudioLines size={13} strokeWidth={2.3} />
      <span>{result.text}</span>
    </div>
  )
}

/** Bubble action: translate into the app language. */
export function TranslateButton({ message }: { message: Message }): JSX.Element | null {
  const t = useT()
  const translate = useAi((s) => s.translate)
  const active = useAi((s) => !!s.results[`t:${textKey(message)}`]?.text && !s.results[`t:${textKey(message)}`]?.hidden)
  if (!message.text.trim()) return null
  return (
    <button className={`icon-btn ${active ? 'active' : ''}`} title={active ? t('aiShowOriginal') : t('aiTranslate')} onClick={() => void translate(message)}>
      <Languages size={15} strokeWidth={2} />
    </button>
  )
}

/** Under the text: the translation, with where it came from. */
export function TranslationBlock({ message }: { message: Message }): JSX.Element | null {
  const t = useT()
  const language = useStore((s) => s.settings.language)
  const key = `t:${textKey(message)}`
  const result = useAi((s) => s.results[key])
  const toggle = useAi((s) => s.toggleHidden)
  const translate = useAi((s) => s.translate)
  if (!result || result.hidden || (!result.text && !result.busy && !result.error)) return null
  if (result.busy) {
    return (
      <div className="bubble-translation busy">
        <BuddyLoader size={14} inline /> {t('aiTranslating')}
      </div>
    )
  }
  if (result.error) {
    return (
      <button className="bubble-translation error" onClick={() => void translate(message)}>
        <AlertCircle size={12} strokeWidth={2.4} /> {result.error}
      </button>
    )
  }
  const from = result.from ? (LANGUAGE_NAMES[result.from]?.[language] ?? result.from) : undefined
  return (
    <div className="bubble-translation">
      <div className="bubble-translation-text">{result.text}</div>
      <button className="bubble-translation-meta" onClick={() => toggle(key)}>
        <Languages size={11} strokeWidth={2.4} />
        {from ? t('aiTranslatedFrom', { language: from }) : t('aiTranslated')} · {t('aiShowOriginal')}
      </button>
    </div>
  )
}

const kindSpec = (kind: AiKind, voiceModel: VoiceModel): { megabytes: number } => (kind === 'voice' ? AI_MODELS.voice[voiceModel] : AI_MODELS.translate)

/** First use: explain, download with progress, then carry on with what the user asked for. */
export function AiSetupSheet(): JSX.Element | null {
  const t = useT()
  const setup = useAi((s) => s.setup)
  const progress = useAi((s) => (s.setup ? s.progress[s.setup.kind] : undefined))
  const prepare = useAi((s) => s.prepare)
  const close = useAi((s) => s.closeSetup)
  const voiceModel = useStore((s) => s.settings.voiceModel ?? 'turbo')
  if (!setup) return null
  const busy = progress?.phase === 'downloading' || progress?.phase === 'loading'
  const size = kindSpec(setup.kind, voiceModel).megabytes
  const start = async (): Promise<void> => {
    const then = setup.then
    if (await prepare(setup.kind)) {
      close()
      then?.()
    }
  }
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <div className="sheet ai-sheet" role="dialog" aria-label={t(setup.kind === 'voice' ? 'aiVoiceTitle' : 'aiTranslateTitle')}>
        <div className="sheet-header">
          <div className="sheet-title">{t(setup.kind === 'voice' ? 'aiVoiceTitle' : 'aiTranslateTitle')}</div>
          <button className="icon-btn" onClick={close} disabled={busy} title={t('close')}>
            <X size={16} strokeWidth={2.4} />
          </button>
        </div>
        <div className="sheet-body">
          <div className="ai-setup">
            <LogoMark size={64} title="" className="ai-setup-buddy" />
            <p>{t(setup.kind === 'voice' ? 'aiVoiceIntro' : 'aiTranslateIntro')}</p>
            <ul className="ai-points">
              <li>
                <ShieldCheck size={15} strokeWidth={2.3} /> {t('aiPrivate')}
              </li>
              <li>
                <Cpu size={15} strokeWidth={2.3} /> {t('aiOnce', { size: `${size} MB` })}
              </li>
            </ul>
            {busy ? (
              <div className="ai-progress">
                <div className="ai-progress-track">
                  <div className="ai-progress-fill" style={{ width: `${Math.round((progress?.phase === 'loading' ? 1 : (progress?.progress ?? 0)) * 100)}%` }} />
                </div>
                <span>
                  {progress?.phase === 'loading' || (progress?.progress ?? 0) >= 0.999
                    ? t('aiStarting')
                    : t('aiDownloading', { percent: String(Math.round((progress?.progress ?? 0) * 100)) })}
                </span>
              </div>
            ) : (
              <>
                {progress?.phase === 'error' && <div className="error-banner">{progress.error}</div>}
                <div className="backup-actions">
                  <button className="btn" onClick={close}>
                    {t('cancel')}
                  </button>
                  <button className="btn primary" onClick={() => void start()}>
                    {t('aiDownload', { size: `${size} MB` })}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Settings: on-device AI models (status, quality, download, free the space). */
export function AiSettings(): JSX.Element {
  const t = useT()
  const status = useAi((s) => s.status)
  const progress = useAi((s) => s.progress)
  const prepare = useAi((s) => s.prepare)
  const remove = useAi((s) => s.remove)
  const refresh = useAi((s) => s.refresh)
  const voiceModel = useStore((s) => s.settings.voiceModel ?? 'turbo')
  const setSettings = useStore((s) => s.setSettings)

  const row = (kind: AiKind, title: string, hint: string): JSX.Element => {
    const ready = !!status?.[kind].ready
    const p = progress[kind]
    const busy = p?.phase === 'downloading' || p?.phase === 'loading'
    const size = kindSpec(kind, voiceModel).megabytes
    return (
      <div className="settings-row ai-row">
        <div className="settings-row-text">
          <div className="settings-row-title">
            {title}
            <span className={`ai-status ${ready ? 'ready' : ''}`}>{ready ? t('aiReady') : t('aiNotDownloaded')}</span>
            {kind === 'voice' && ready && status?.voice.gpu && <span className='ai-status gpu' title={t('aiGpuHint')}>GPU</span>}
          </div>
          <div className="settings-row-sub">{hint}</div>
          {kind === 'voice' && (
            <div className="segmented ai-quality">
              {(['turbo', 'small'] as VoiceModel[]).map((m) => (
                <button key={m} className={voiceModel === m ? 'active' : ''} onClick={() => void setSettings({ voiceModel: m }).then(() => refresh())}>
                  {m === 'turbo' ? t('aiQualityBest') : t('aiQualityLight')} · {AI_MODELS.voice[m].megabytes} MB
                </button>
              ))}
            </div>
          )}
          {busy && (
            <div className="ai-progress inline">
              <div className="ai-progress-track">
                <div className="ai-progress-fill" style={{ width: `${Math.round((p?.phase === 'loading' ? 1 : (p?.progress ?? 0)) * 100)}%` }} />
              </div>
            </div>
          )}
          {p?.phase === 'error' && <div className="field-error">{p.error}</div>}
        </div>
        {ready ? (
          <button className="icon-btn" title={t('aiRemove')} onClick={() => void remove(kind)} disabled={busy}>
            <Trash2 size={15} strokeWidth={2.2} />
          </button>
        ) : (
          <button className="btn" onClick={() => void prepare(kind)} disabled={busy}>
            {busy ? <BuddyLoader size={16} inline /> : `${t('aiGet')} · ${size} MB`}
          </button>
        )}
      </div>
    )
  }

  return (
    <>
      {row('voice', t('aiVoiceTitle'), t('aiVoiceHint'))}
      {row('translate', t('aiTranslateTitle'), t('aiTranslateHint'))}
      <div className="settings-row">
        <div className="settings-row-text">
          <div className="settings-row-sub">
            <ShieldCheck size={12} strokeWidth={2.4} style={{ verticalAlign: '-2px' }} /> {t('aiPrivate')}
            {status && status.bytes > 0 ? ` · ${t('aiSpace', { size: formatBytes(status.bytes) })}` : ''}
          </div>
        </div>
      </div>
    </>
  )
}
