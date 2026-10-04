import { useEffect, useState } from 'react'
import { AlertCircle, AudioLines, Captions, Cpu, FolderOutput, Languages, RefreshCw, ShieldCheck, Sparkles, Trash2, Upload, Volume2, X } from 'lucide-react'
import { AI_MODELS, CHAT_MODELS, chatModelOf, type AiKind, type ChatAdvice, type ChatModel, type Hardware, type SpeakLang, type VoiceInfo, type VoiceModel } from '@shared/ai'
import { tagDefsOf, type Attachment, type Message } from '@shared/types'
import { textKey, useAi, voiceKey } from '../aiStore'
import { useStore, useT, useThread } from '../store'
import { formatBytes, tip } from '../utils'
import { BuddyLoader } from './BuddyLoader'
import { LogoMark } from './Logo'

export const LANGUAGE_NAMES: Record<string, { vi: string; en: string }> = {
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
    <button className={`icon-btn ${active ? 'active' : ''}`} {...tip(active ? t('aiShowOriginal') : t('aiTranslate'))} onClick={() => void translate(message)}>
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

const kindSpec = (kind: AiKind, voiceModel: VoiceModel, chatModel: ChatModel, speakLang: SpeakLang = 'vi'): { megabytes: number } =>
  kind === 'voice' ? AI_MODELS.voice[voiceModel] : kind === 'chat' ? AI_MODELS.chat[chatModel] : kind === 'speak' ? AI_MODELS.speak[speakLang] : kind === 'cutout' ? AI_MODELS.cutout : AI_MODELS.translate
const titleKey = (kind: AiKind): 'aiVoiceTitle' | 'aiTranslateTitle' | 'aiChatTitle' | 'aiSpeakTitle' | 'aiCutoutTitle' =>
  kind === 'voice' ? 'aiVoiceTitle' : kind === 'chat' ? 'aiChatTitle' : kind === 'speak' ? 'aiSpeakTitle' : kind === 'cutout' ? 'aiCutoutTitle' : 'aiTranslateTitle'
const introKey = (kind: AiKind): 'aiVoiceIntro' | 'aiTranslateIntro' | 'aiChatIntro' | 'aiSpeakIntro' | 'aiCutoutIntro' =>
  kind === 'voice' ? 'aiVoiceIntro' : kind === 'chat' ? 'aiChatIntro' : kind === 'speak' ? 'aiSpeakIntro' : kind === 'cutout' ? 'aiCutoutIntro' : 'aiTranslateIntro'

/** First use: explain, download with progress, then carry on with what the user asked for. */
export function AiSetupSheet(): JSX.Element | null {
  const t = useT()
  const setup = useAi((s) => s.setup)
  const progress = useAi((s) => (s.setup ? s.progress[s.setup.kind] : undefined))
  const prepare = useAi((s) => s.prepare)
  const close = useAi((s) => s.closeSetup)
  const voiceModel = useStore((s) => s.settings.voiceModel ?? 'turbo')
  const chatModel = useStore((s) => chatModelOf(s.settings.chatModel))
  const speakLang = useAi((s) => s.speakLang ?? 'vi')
  if (!setup) return null
  const busy = progress?.phase === 'downloading' || progress?.phase === 'loading'
  const size = kindSpec(setup.kind, voiceModel, chatModel, speakLang).megabytes
  const start = async (): Promise<void> => {
    const then = setup.then
    if (await prepare(setup.kind)) {
      close()
      then?.()
    }
  }
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <div className="sheet ai-sheet" role="dialog" aria-label={t(titleKey(setup.kind))}>
        <div className="sheet-header">
          <div className="sheet-title">{t(titleKey(setup.kind))}</div>
          <button className="icon-btn" onClick={close} disabled={busy} title={t('close')}>
            <X size={16} strokeWidth={2.4} />
          </button>
        </div>
        <div className="sheet-body">
          <div className="ai-setup">
            <LogoMark size={64} title="" className="ai-setup-buddy" />
            <p>{t(introKey(setup.kind))}</p>
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

const MODEL_NAME: Record<ChatModel, string> = { 'qwen35-0.8b': 'Qwen3.5 0.8B', 'qwen35-2b': 'Qwen3.5 2B', 'qwen35-4b': 'Qwen3.5 4B', 'qwen35-9b': 'Qwen3.5 9B', 'gemma4-12b': 'Gemma 4 12B' }
const MODEL_TONE: Record<ChatModel, 'aiModelTiny' | 'aiModelLight' | 'aiModelBalanced' | 'aiModelBest' | 'aiModelTop'> = {
  'qwen35-0.8b': 'aiModelTiny',
  'qwen35-2b': 'aiModelLight',
  'qwen35-4b': 'aiModelBalanced',
  'qwen35-9b': 'aiModelBest',
  'gemma4-12b': 'aiModelTop'
}

/**
 * The language model: what this machine has (GPU, its memory, RAM), the two models that suit it, and the others
 * on request. A model too big for the machine still shows, marked, for whoever wants to try.
 */
function ChatModelPicker({ current, onPick }: { current: ChatModel; onPick(model: ChatModel): void }): JSX.Element {
  const t = useT()
  const [info, setInfo] = useState<{ hardware: Hardware; advice: ChatAdvice } | undefined>()
  const [all, setAll] = useState(false)
  useEffect(() => {
    let live = true
    void window.unison.ai.hardware().then((v) => live && setInfo(v)).catch(() => undefined)
    return () => {
      live = false
    }
  }, [])
  const picks = info?.advice.picks ?? (['qwen35-4b', 'qwen35-2b'] as ChatModel[])
  const shown = all ? [...CHAT_MODELS].reverse() : [...picks, ...(picks.includes(current) ? [] : [current])]
  const hw = info?.hardware
  const gb = (n: number): string => `${Math.round(n)} GB`
  const tooBig = (m: ChatModel): boolean => !!hw && AI_MODELS.chat[m].needsGb > (hw.gpu ? Math.max(hw.vramGb, hw.ramGb * 0.5) : hw.ramGb * 0.5)
  return (
    <div className="ai-models">
      <div className="ai-hw">
        <Cpu size={13} strokeWidth={2.2} />
        {hw
          ? hw.gpu
            ? hw.unified
              ? t('aiHwApple', { ram: gb(hw.ramGb) })
              : t('aiHwGpu', { gpu: hw.gpuName ?? 'GPU', vram: gb(hw.vramGb), ram: gb(hw.ramGb) })
            : t('aiHwCpu', { ram: gb(hw.ramGb) })
          : t('aiHwChecking')}
      </div>
      {shown.map((m) => {
        const pick = picks.indexOf(m)
        return (
          <button key={m} className={`ai-model ${current === m ? 'active' : ''}`} onClick={() => onPick(m)} aria-pressed={current === m}>
            <span className="ai-model-head">
              <b>{MODEL_NAME[m]}</b>
              {pick === 0 && <span className="ai-model-badge best">{t('aiModelRecommended')}</span>}
              {pick === 1 && <span className="ai-model-badge">{t('aiModelLighter')}</span>}
              {tooBig(m) && <span className="ai-model-badge warn">{t('aiModelTooBig')}</span>}
              <span className="ai-model-size">{(AI_MODELS.chat[m].megabytes / 1024).toFixed(1)} GB</span>
            </span>
            <span className="ai-model-sub">{t(MODEL_TONE[m])}{pick === 0 && info?.advice.on === 'cpu' ? ` · ${t('aiModelOnCpu')}` : ''}</span>
          </button>
        )
      })}
      <button className="ai-models-more" onClick={() => setAll((a) => !a)}>
        {all ? t('aiModelsFewer') : t('aiModelsAll')}
      </button>
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
  const chatModel = useStore((s) => chatModelOf(s.settings.chatModel))
  const suggestLanguage = useStore((s) => s.settings.suggestLanguage)
  const aiSuggest = useStore((s) => s.settings.aiSuggest !== false)
  const setSettings = useStore((s) => s.setSettings)

  const row = (kind: AiKind, title: string, hint: string): JSX.Element => {
    const ready = kind === 'speak' ? !!status?.speak.vi || !!status?.speak.en : !!status?.[kind].ready
    const p = progress[kind]
    const busy = p?.phase === 'downloading' || p?.phase === 'loading'
    const size = kindSpec(kind, voiceModel, chatModel).megabytes
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
          {kind === 'speak' && status && (
            <div className="ai-langs">
              {(['vi', 'en'] as SpeakLang[]).map((lang) => (
                <button key={lang} className={`ai-lang ${status.speak[lang] ? 'ready' : ''}`} disabled={busy || status.speak[lang]} onClick={() => void prepare('speak', lang)}>
                  {lang === 'vi' ? t('langVi') : t('langEn')} · {status.speak[lang] ? t('aiReady') : `${AI_MODELS.speak[lang].megabytes} MB`}
                </button>
              ))}
            </div>
          )}
          {kind === 'chat' && (
            <>
              <ChatModelPicker current={chatModel} onPick={(m) => void setSettings({ chatModel: m }).then(() => refresh())} />
              <div className="ai-suggest-lang">
                <span className="ai-suggest-lang-label">{t('suggestLanguage')}</span>
                <div className="segmented">
                  {(['auto', 'vi', 'en'] as const).map((l) => (
                    <button key={l} className={(suggestLanguage ?? 'auto') === l ? 'active' : ''} onClick={() => void setSettings({ suggestLanguage: l })}>
                      {l === 'auto' ? t('suggestLangAuto') : l === 'vi' ? t('langVi') : t('langEn')}
                    </button>
                  ))}
                </div>
              </div>
            </>
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
      {row('chat', t('aiChatTitle'), t('aiChatHint'))}
      {row('speak', t('aiSpeakTitle'), t('aiSpeakHint'))}
      {row('cutout', t('aiCutoutTitle'), t('aiCutoutHint'))}
      <div className="settings-row">
        <div className="settings-row-text">
          <div className="settings-row-title">{t('aiSuggestAuto')}</div>
          <div className="settings-row-sub">{t('aiSuggestAutoHint')}</div>
        </div>
        <button className={`switch ${aiSuggest ? 'on' : ''}`} role="switch" aria-checked={aiSuggest} onClick={() => void setSettings({ aiSuggest: !aiSuggest })} />
      </div>
      <YourVoice />
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

/**
 * Settings: suggestions in the user's own voice. Examples from their earlier replies (on by default), the tags
 * whose chats are left out, and the personal voice: export the training folder, use a trained file, remove it.
 */
function YourVoice(): JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const examplesOn = settings.aiStyleExamples !== false
  const loraOn = settings.aiLora !== false
  const skip = settings.aiStyleSkipTags ?? []
  const chatModel = chatModelOf(settings.chatModel)
  const [info, setInfo] = useState<VoiceInfo>()
  const [exported, setExported] = useState<{ folder: string; count: number }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let live = true
    void window.unison.ai.voiceInfo().then((i) => live && setInfo(i)).catch(() => undefined)
    return () => {
      live = false
    }
  }, [chatModel, skip.join(',')])

  const run = async (task: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      await task()
    } catch (err) {
      setError(((err as Error).message ?? String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }
  const toggleTag = (id: string): void => void setSettings({ aiStyleSkipTags: skip.includes(id) ? skip.filter((x) => x !== id) : [...skip, id] })
  const mac = navigator.userAgent.includes('Mac')

  return (
    <>
      <div className="settings-row">
        <div className="settings-row-text">
          <div className="settings-row-title">{t('voiceExamplesTitle')}</div>
          <div className="settings-row-sub">{info ? t('voiceExamplesHint', { n: info.pairs.toLocaleString() }) : t('voiceExamplesHintShort')}</div>
          {examplesOn && (
            <div className="voice-skip">
              <span className="voice-skip-label">{t('voiceSkipTags')}</span>
              <div className="ai-langs">
                {tagDefsOf(settings).map((tag) => (
                  <button key={tag.id} className={`ai-lang voice-tag ${skip.includes(tag.id) ? 'off' : ''}`} aria-pressed={skip.includes(tag.id)} onClick={() => toggleTag(tag.id)}>
                    {tag.name[settings.language]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <button className={`switch ${examplesOn ? 'on' : ''}`} role="switch" aria-checked={examplesOn} onClick={() => void setSettings({ aiStyleExamples: !examplesOn })} />
      </div>
      <div className="settings-row ai-row voice-lora">
        <div className="settings-row-text">
          <div className="settings-row-title">
            {t('voiceLoraTitle')}
            {info?.training && <span className="ai-status">{t('voiceTraining')}</span>}
            {info?.present ? (
              <span className={`ai-status ${info.error ? 'error' : 'ready'}`}>{info.error ? t('voiceLoraMismatch') : t('voiceLoraOn', { model: MODEL_NAME[info.model] })}</span>
            ) : (
              <span className="ai-status">{t('voiceLoraNone')}</span>
            )}
          </div>
          <div className="settings-row-sub">{t('voiceLoraHint', { model: MODEL_NAME[chatModel] })}</div>
          <div className="voice-lora-actions">
            <button className="btn" disabled={busy || !info?.pairs} onClick={() => void run(async () => {
              const result = await window.unison.ai.voiceExport()
              if (result) setExported(result)
            })}>
              <FolderOutput size={14} strokeWidth={2.3} /> {t('voiceExport')}
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => void run(async () => {
              const next = await window.unison.ai.voiceInstall()
              if (next) setInfo(next)
            })}>
              <Upload size={14} strokeWidth={2.3} /> {t('voiceInstall')}
            </button>
            {info?.present && (
              <button className="icon-btn" title={t('voiceRemove')} disabled={busy} onClick={() => void run(async () => setInfo(await window.unison.ai.voiceRemove()))}>
                <Trash2 size={15} strokeWidth={2.2} />
              </button>
            )}
          </div>
          {exported && <div className="voice-exported">{t(mac ? 'voiceExportedMac' : 'voiceExportedWin', { n: exported.count.toLocaleString() })}</div>}
          {info?.error && <div className="field-error">{info.error}</div>}
          {error && <div className="field-error">{error}</div>}
        </div>
        {info?.present && <button className={`switch ${loraOn ? 'on' : ''}`} role="switch" aria-checked={loraOn} title={t('voiceLoraUse')} onClick={() => void setSettings({ aiLora: !loraOn })} />}
      </div>
    </>
  )
}

/** Header button + card: a few bullet points about what was unread (or the recent conversation). */
export function SummaryButton({ conversationId }: { conversationId: string }): JSX.Element | null {
  const t = useT()
  const summarize = useAi((s) => s.summarize)
  const state = useAi((s) => s.summaries[conversationId])
  const unread = useAi((s) => s.unreadAtOpen[conversationId] ?? 0)
  // Only once the chat model is downloaded (Settings → AI); no AI buttons for people who never set it up.
  const ready = useAi((s) => !!s.status?.chat.ready)
  const active = !!state?.bullets && !state.hidden
  if (!ready) return null
  return (
    <button className={`icon-btn ${active ? 'active' : ''}`} onClick={() => void summarize(conversationId)} title={unread >= 3 ? t('aiSummaryUnread', { count: String(unread) }) : t('aiSummarize')}>
      <Sparkles size={18} strokeWidth={2} />
    </button>
  )
}

export function SummaryCard({ conversationId }: { conversationId: string }): JSX.Element | null {
  const t = useT()
  const state = useAi((s) => s.summaries[conversationId])
  const summarize = useAi((s) => s.summarize)
  const dismiss = useAi((s) => s.dismissSummary)
  if (!state || state.hidden) return null
  return (
    <div className="summary-card" role="status">
      <div className="summary-head">
        <Sparkles size={14} strokeWidth={2.4} />
        <span>{state.count ? t('aiSummaryUnread', { count: String(state.count) }) : t('aiSummaryRecent')}</span>
        <span className="summary-spacer" />
        {!state.busy && (
          <button className="icon-btn small" onClick={() => void summarize(conversationId, true)} title={t('aiSummarizeAgain')}>
            <RefreshCw size={13} strokeWidth={2.4} />
          </button>
        )}
        <button className="icon-btn small" onClick={() => dismiss(conversationId)} title={t('close')}>
          <X size={13} strokeWidth={2.6} />
        </button>
      </div>
      {state.busy && (
        <div className="summary-busy">
          <BuddyLoader size={16} inline /> {t('aiSummarizing')}
        </div>
      )}
      {state.error && <div className="field-error">{state.error}</div>}
      {state.bullets && (
        <ul className="summary-list">
          {state.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
      {!state.busy && !state.error && !state.bullets && <div className="summary-busy">{t('aiNothingToSummarize')}</div>}
    </div>
  )
}

/** Over the composer: three ways to answer the newest message; one tap puts it in the box. */
export function SuggestionChips({ conversationId }: { conversationId: string }): JSX.Element | null {
  const t = useT()
  const state = useAi((s) => s.suggestions[conversationId])
  const suggest = useAi((s) => s.suggest)
  const openerAgain = useAi((s) => s.opener)
  const clear = useAi((s) => s.clearSuggestions)
  const ready = useAi((s) => !!s.status?.chat.ready)
  const setComposerDraft = useStore((s) => s.setComposerDraft)
  // A merged person's newest message, whichever of its chats it came in.
  const last = useThread(conversationId).messages?.at(-1)
  const opener = state?.opener
  if (opener && !state.busy && !state.items?.length) return null
  if (!opener && (!last || last.isOutgoing || last.system)) return null
  if (!ready && !state?.busy && !state?.items?.length) return null
  if (!state?.items?.length && !state?.busy) {
    // Nothing yet: a quiet chip asks for suggestions (and the download, the first time).
    return (
      <div className="suggest-row">
        <button className="suggest-chip ask" onClick={() => void suggest(conversationId, true)} title={t('aiSuggestHint')}>
          <Sparkles size={13} strokeWidth={2.4} /> {ready ? t('aiSuggestNow') : t('aiSuggestTitle')}
        </button>
      </div>
    )
  }
  return (
    <div className="suggest-row">
      {state.busy && (
        <span className="suggest-chip busy">
          <BuddyLoader size={14} inline /> {t('aiThinking')}
        </span>
      )}
      {state.items?.map((text) => (
        <button
          key={text}
          className="suggest-chip"
          onClick={() => {
            setComposerDraft(conversationId, text)
            clear(conversationId)
          }}
        >
          {text}
        </button>
      ))}
      {!state.busy && (
        <button
          className="icon-btn small"
          onClick={() => {
            if (!opener) return void suggest(conversationId, true)
            clear(conversationId)
            void openerAgain(conversationId, state.silentDays ?? 0)
          }}
          title={t('aiSuggestAgain')}
        >
          <RefreshCw size={12} strokeWidth={2.4} />
        </button>
      )}
    </div>
  )
}

/** In the bubble's action bar: read this message aloud; press again to stop. */
export function SpeakButton({ message, text }: { message: Message; text?: string }): JSX.Element | null {
  const t = useT()
  const speak = useAi((s) => s.speak)
  const speaking = useAi((s) => s.speaking === textKey(message))
  if (!(text ?? message.text).trim()) return null
  return (
    <button className={`icon-btn ${speaking ? 'active' : ''}`} {...tip(speaking ? t('aiSpeakStop') : t('aiSpeak'))} onClick={() => void speak(message, text)} aria-pressed={speaking}>
      <Volume2 size={15} strokeWidth={2} />
    </button>
  )
}
