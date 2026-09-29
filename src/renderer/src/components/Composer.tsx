import { useEffect, useRef, useState } from 'react'
import { AlarmClock, ArrowUp, File, Languages, Mic, Paperclip, Reply, Smile, Sticker, Trash2, Undo2, X } from 'lucide-react'
import { useAi } from '../aiStore'
import { TranslatePicker, languageName } from './TranslatePicker'
import { readDraft, useStore, useT } from '../store'
import { formatBytes } from '../utils'
import { EmojiPicker } from './EmojiPicker'
import { StickerPicker } from './StickerPicker'
import { GifPicker } from './GifPicker'
import { QuickReplyMenu, SchedulePicker, matchQuickReplies, useQuickReplies } from './ComposerExtras'
import { SuggestionChips } from './AiParts'
import { fillQuickReply, givenName } from '@shared/extras'
import type { QuickReply } from '@shared/types'

interface Props {
  /** The chat this composer writes to (each pane of a split view has its own). */
  conversationId: string
  /** Whether its pane is the active one: only the active composer takes keyboard focus. */
  active?: boolean
  disabled?: boolean
  canAttach: boolean
  canVoice?: boolean
}

const NO_FILES: never[] = []

interface Recording {
  recorder: MediaRecorder
  /** A second, AAC copy for platforms that play .m4a voice notes (Instagram, Messenger). */
  aac?: { recorder: MediaRecorder; chunks: Blob[] }
  stream: MediaStream
  chunks: Blob[]
  startedAt: number
}

const AAC_TYPE = 'audio/mp4;codecs=mp4a.40.2'

const stopped = (recorder: MediaRecorder): Promise<void> =>
  new Promise((resolve) => {
    if (recorder.state === 'inactive') return resolve()
    recorder.addEventListener('stop', () => resolve(), { once: true })
    recorder.stop()
  })

export function Composer({ conversationId, active = true, disabled, canAttach, canVoice = canAttach }: Props): JSX.Element {
  const t = useT()
  const send = useStore((s) => s.send)
  const notifyTyping = useStore((s) => s.notifyTyping)
  const sendOnEnter = useStore((s) => s.settings.sendOnEnter)
  const selectedId = conversationId
  const replyTo = useStore((s) => s.replyTos[conversationId])
  const setReplyTo = useStore((s) => s.setReplyTo)
  const pendingFiles = useStore((s) => s.pendingFiles[conversationId] ?? NO_FILES)
  const focusRequest = useStore((s) => s.composerFocus)
  const addFiles = useStore((s) => s.addFiles)
  const addDroppedFiles = useStore((s) => s.addDroppedFiles)
  const removeFile = useStore((s) => s.removeFile)
  const showToast = useStore((s) => s.showToast)
  const [text, setText] = useState('')
  const [recording, setRecording] = useState<Recording | undefined>()
  const [elapsed, setElapsed] = useState(0)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [stickersOpen, setStickersOpen] = useState(false)
  const [gifsOpen, setGifsOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const scheduleMessage = useStore((s) => s.scheduleMessage)
  const composerDraft = useStore((s) => s.composerDrafts[conversationId])
  // Translating what you type: the language is remembered per chat; "auto" translates every message on send.
  const language = useStore((s) => s.settings.language)
  const override = useStore((s) => s.settings.contactOverrides?.[conversationId])
  const setContactOverride = useStore((s) => s.setContactOverride)
  const translateText = useAi((s) => s.translateText)
  const [translateOpen, setTranslateOpen] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [translated, setTranslated] = useState<{ original: string; to: string } | undefined>()
  const translateTarget = override?.translateTo
  const translateAuto = !!override?.translateAuto && !!translateTarget
  const partnerName = useStore((s) => s.conversations[conversationId]?.title)
  const quickReplies = useQuickReplies()
  // "/query" right before the caret opens the quick replies menu.
  const [slash, setSlash] = useState<{ start: number; end: number; query: string } | null>(null)
  const [slashIndex, setSlashIndex] = useState(0)
  const slashItems = slash ? matchQuickReplies(quickReplies, slash.query) : []
  const sendGif = useStore((s) => s.sendGif)
  const ref = useRef<HTMLTextAreaElement>(null)

  const focusInput = (): void => ref.current?.focus({ preventScroll: true })

  const setDraft = useStore((s) => s.setDraft)
  // Each chat keeps its own unsent text (restored when you come back, even after a restart).
  // The save below skips the render where the chat just switched: its text still belongs to the previous chat.
  const switching = useRef(false)
  useEffect(() => {
    switching.current = true
    setText(selectedId ? readDraft(selectedId) : '')
    setEmojiOpen(false)
    setTranslated(undefined)
    setTranslateOpen(false)
    if (active) focusInput()
    // The pane's active state only matters on the first render of this chat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])
  // Focus asked for by the store (a pane switched by keyboard, or a chat picked from the list).
  useEffect(() => {
    if (focusRequest?.conversationId === conversationId) focusInput()
  }, [focusRequest, conversationId])
  useEffect(() => {
    if (switching.current) {
      switching.current = false
      return
    }
    if (selectedId) setDraft(selectedId, text)
  }, [text, selectedId, setDraft])

  useEffect(() => {
    if (replyTo && active) focusInput()
  }, [replyTo, active])

  // Something else asked the composer to take over a draft (e.g. the birthday banner).
  useEffect(() => {
    if (!composerDraft) return
    setText(composerDraft.text)
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus({ preventScroll: true })
      el.setSelectionRange(composerDraft.text.length, composerDraft.text.length)
    })
  }, [composerDraft])

  const updateSlash = (value: string, caret: number): void => {
    const m = /(^|\s)\/([\p{L}\p{N}_-]{0,24})$/u.exec(value.slice(0, caret))
    if (!m || !quickReplies.length) {
      setSlash(null)
      return
    }
    setSlash({ start: caret - m[2].length - 1, end: caret, query: m[2] })
    setSlashIndex(0)
  }

  const insertQuickReply = (reply: QuickReply): void => {
    if (!slash) return
    const filled = fillQuickReply(reply.text, givenName(partnerName ?? '') || (partnerName ?? ''))
    const next = text.slice(0, slash.start) + filled + text.slice(slash.end)
    const caret = slash.start + filled.length
    setText(next)
    setSlash(null)
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus({ preventScroll: true })
      el.setSelectionRange(caret, caret)
    })
  }

  const scheduleCurrent = (sendAt: number): void => {
    setScheduleOpen(false)
    const value = text
    setText('')
    void scheduleMessage(conversationId, value, sendAt)
    focusInput()
  }

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
    // Windows draws a classic scrollbar for any overflow, even a rounding pixel; only scroll once the box is at its max height.
    el.style.overflowY = el.scrollHeight > 160 ? 'auto' : 'hidden'
  }, [text])

  useEffect(() => {
    if (!recording) return
    const timer = setInterval(() => setElapsed((Date.now() - recording.startedAt) / 1000), 200)
    return () => clearInterval(timer)
  }, [recording])

  const translateDraft = async (): Promise<void> => {
    if (!translateTarget || !text.trim() || translating) return
    setTranslating(true)
    try {
      const result = await translateText(text, translateTarget)
      if (result && result.text.trim() && result.text !== text) {
        setTranslated({ original: text, to: translateTarget })
        setText(result.text)
      }
    } finally {
      setTranslating(false)
      setTranslateOpen(false)
      focusInput()
    }
  }

  const submit = (): void => {
    if ((!text.trim() && !pendingFiles.length) || disabled || translating) return
    // Auto-translate: the message goes out in the other language, straight from the draft.
    if (translateAuto && text.trim() && !translated) {
      setTranslating(true)
      void translateText(text, translateTarget!)
        .then((result) => {
          if (!result) return
          void send(conversationId, result.text.trim() ? result.text : text)
          setText('')
          setTranslated(undefined)
        })
        .finally(() => {
          setTranslating(false)
          focusInput()
        })
      return
    }
    void send(conversationId, text)
    setText('')
    setTranslated(undefined)
    focusInput()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (slash && slashItems.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const step = e.key === 'ArrowDown' ? 1 : -1
        setSlashIndex((i) => (i + step + slashItems.length) % slashItems.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertQuickReply(slashItems[Math.min(slashIndex, slashItems.length - 1)])
        return
      }
    }
    if (e.key === 'Escape' && slash) {
      setSlash(null)
      return
    }
    if (e.key === 'Escape' && replyTo) {
      setReplyTo(conversationId, undefined)
      return
    }
    if (e.key !== 'Enter') return
    const wantsSend = sendOnEnter ? !e.shiftKey : e.ctrlKey || e.metaKey
    if (wantsSend) {
      e.preventDefault()
      submit()
    }
  }

  const onPaste = (e: React.ClipboardEvent): void => {
    if (!canAttach) return
    const files = [...e.clipboardData.files]
    if (files.length) {
      e.preventDefault()
      addDroppedFiles(conversationId, files)
    }
  }

  const pick = async (): Promise<void> => {
    const files = await window.unison.app.pickFiles()
    if (files.length) addFiles(conversationId, files)
    focusInput()
  }

  const insertEmoji = (emoji: string): void => {
    const el = ref.current
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    const next = text.slice(0, start) + emoji + text.slice(end)
    setText(next)
    requestAnimationFrame(() => {
      if (!el) return
      el.focus({ preventScroll: true })
      el.setSelectionRange(start + emoji.length, start + emoji.length)
    })
  }

  const startRecording = async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32_000 })
      const session: Recording = { recorder, stream, chunks: [], startedAt: Date.now() }
      recorder.ondataavailable = (e) => e.data.size && session.chunks.push(e.data)
      if (MediaRecorder.isTypeSupported(AAC_TYPE)) {
        const aac = { recorder: new MediaRecorder(stream, { mimeType: AAC_TYPE, audioBitsPerSecond: 64_000 }), chunks: [] as Blob[] }
        aac.recorder.ondataavailable = (e) => e.data.size && aac.chunks.push(e.data)
        aac.recorder.start()
        session.aac = aac
      }
      recorder.start(250)
      setElapsed(0)
      setRecording(session)
    } catch {
      showToast(t('micDenied'), 'error')
    }
  }

  const finishRecording = (sendIt: boolean): void => {
    const session = recording
    if (!session) return
    setRecording(undefined)
    const duration = (Date.now() - session.startedAt) / 1000
    void (async () => {
      await Promise.all([stopped(session.recorder), session.aac ? stopped(session.aac.recorder) : Promise.resolve()])
      session.stream.getTracks().forEach((track) => track.stop())
      if (!sendIt || duration < 0.6) return
      try {
        const blob = new Blob(session.chunks, { type: session.recorder.mimeType })
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const aac = session.aac?.chunks.length ? new Uint8Array(await new Blob(session.aac.chunks, { type: 'audio/mp4' }).arrayBuffer()) : undefined
        const voice = await window.unison.app.saveVoice(bytes, duration, aac)
        await send(conversationId, '', [voice])
      } catch (err) {
        showToast((err as Error).message, 'error')
      }
    })()
  }

  const canSend = (text.trim().length > 0 || pendingFiles.length > 0) && !disabled
  const mm = Math.floor(elapsed / 60)
  const ss = Math.floor(elapsed % 60)

  return (
    <div className="composer">
      {replyTo && (
        <div className="reply-banner">
          <Reply size={14} strokeWidth={2.4} />
          <div className="reply-banner-text">
            <strong>{t('replyingTo', { name: replyTo.senderName })}</strong>
            <span>{replyTo.text || t('attachment')}</span>
          </div>
          <button className="icon-btn" onClick={() => setReplyTo(conversationId, undefined)} title={t('cancelReply')}>
            <X size={14} strokeWidth={2.4} />
          </button>
        </div>
      )}
      {translated && (
        <div className="reply-banner translate-strip">
          <Languages size={14} strokeWidth={2.4} />
          <div className="reply-banner-text">
            <strong>{t('translatedTo', { lang: languageName(translated.to, language) })}</strong>
            <span>{translated.original}</span>
          </div>
          <button
            className="icon-btn"
            title={t('translateUndo')}
            onClick={() => {
              setText(translated.original)
              setTranslated(undefined)
              focusInput()
            }}
          >
            <Undo2 size={14} strokeWidth={2.4} />
          </button>
        </div>
      )}
      {pendingFiles.length > 0 && (
        <div className="pending-files">
          {pendingFiles.map((file) => (
            <div key={file.path} className="pending-file" title={file.path}>
              {file.preview && file.mime.startsWith('image/') ? (
                <img src={file.preview} alt="" draggable={false} />
              ) : (
                <span className="pending-file-icon">{file.voice ? <Mic size={16} /> : <File size={16} />}</span>
              )}
              <span className="pending-file-text">
                <span className="pending-file-name">{file.voice ? t('voice') : file.name}</span>
                <span className="pending-file-meta">{formatBytes(file.size)}</span>
              </span>
              <button className="pending-file-remove" onClick={() => removeFile(conversationId, file.path)} title={t('remove')}>
                <X size={11} strokeWidth={3} />
              </button>
            </div>
          ))}
        </div>
      )}
      {!recording && !disabled && <SuggestionChips conversationId={conversationId} />}
      {recording ? (
        <div className="composer-box recording">
          <button className="icon-btn composer-attach" onClick={() => finishRecording(false)} title={t('cancel')}>
            <Trash2 size={18} strokeWidth={2} />
          </button>
          <span className="recording-dot" />
          <span className="recording-time">
            {mm}:{ss.toString().padStart(2, '0')}
          </span>
          <span className="recording-label">{t('recording')}</span>
          <button className="composer-send visible" onClick={() => finishRecording(true)} title={t('send')}>
            <ArrowUp size={18} strokeWidth={2.6} />
          </button>
        </div>
      ) : (
        <div className="composer-box">
          {slash && <QuickReplyMenu items={slashItems} active={Math.min(slashIndex, Math.max(0, slashItems.length - 1))} onPick={insertQuickReply} onHover={setSlashIndex} />}
          {canAttach && (
            <button className="icon-btn composer-attach" onClick={() => void pick()} title={t('attach')} disabled={disabled}>
              <Paperclip size={18} strokeWidth={2} />
            </button>
          )}
          <textarea
            ref={ref}
            className="composer-input"
            rows={1}
            placeholder={t('composerPlaceholder')}
            value={text}
            disabled={disabled}
            onChange={(e) => {
              setText(e.target.value)
              updateSlash(e.target.value, e.target.selectionStart ?? e.target.value.length)
              if (e.target.value) notifyTyping(conversationId)
            }}
            onBlur={() => setSlash(null)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
          <div className="composer-tools">
            <span className="emoji-anchor">
              <button className={`icon-btn ${emojiOpen ? 'active' : ''}`} onClick={() => setEmojiOpen((o) => !o)} title={t('emoji')} disabled={disabled}>
                <Smile size={18} strokeWidth={2} />
              </button>
              {emojiOpen && <EmojiPicker onPick={insertEmoji} onClose={() => setEmojiOpen(false)} />}
            </span>
            {canAttach && (
              <span className="emoji-anchor">
                <button
                  className={`icon-btn ${stickersOpen ? 'active' : ''}`}
                  onMouseDown={(e) => stickersOpen && e.stopPropagation()}
                  onClick={() => setStickersOpen((o) => !o)}
                  title={t('stickers')}
                  disabled={disabled}
                >
                  <Sticker size={18} strokeWidth={2} />
                </button>
                {stickersOpen && (
                  <StickerPicker
                    onClose={() => setStickersOpen(false)}
                    onPick={(id) => {
                      setStickersOpen(false)
                      void (async () => {
                        try {
                          await send(conversationId, '', [await window.unison.app.sticker(id)])
                        } catch (err) {
                          showToast((err as Error).message, 'error')
                        }
                      })()
                    }}
                  />
                )}
              </span>
            )}
            {canAttach && (
              <span className="emoji-anchor">
                <button
                  className={`icon-btn gif-btn ${gifsOpen ? 'active' : ''}`}
                  onMouseDown={(e) => gifsOpen && e.stopPropagation()}
                  onClick={() => setGifsOpen((o) => !o)}
                  title="GIF"
                  aria-label="GIF"
                  disabled={disabled}
                >
                  <span className="gif-glyph">GIF</span>
                </button>
                {gifsOpen && (
                  <GifPicker
                    onClose={() => setGifsOpen(false)}
                    onPick={(item) => {
                      setGifsOpen(false)
                      void sendGif(conversationId, item)
                      focusInput()
                    }}
                  />
                )}
              </span>
            )}
            {canVoice && (
              <button className="icon-btn" onClick={() => void startRecording()} title={t('recordVoice')} disabled={disabled}>
                <Mic size={18} strokeWidth={2} />
              </button>
            )}
            {(text.trim() || translateAuto) && (
              <span className="emoji-anchor">
                <button
                  className={`icon-btn translate-btn ${translateOpen || translateAuto ? 'active' : ''}`}
                  onMouseDown={(e) => translateOpen && e.stopPropagation()}
                  onClick={() => setTranslateOpen((o) => !o)}
                  title={translateAuto && translateTarget ? t('translateAutoOn', { lang: languageName(translateTarget, language) }) : t('translateDraft')}
                  disabled={disabled}
                >
                  <Languages size={18} strokeWidth={2} />
                  {translateAuto && translateTarget && <span className="translate-badge">{translateTarget.toUpperCase()}</span>}
                </button>
                {translateOpen && (
                  <TranslatePicker
                    target={translateTarget}
                    auto={translateAuto}
                    busy={translating}
                    onTarget={(code) => void setContactOverride(conversationId, { ...override, translateTo: code })}
                    onAuto={(on) => void setContactOverride(conversationId, { ...override, translateTo: translateTarget, translateAuto: on })}
                    onTranslate={() => void translateDraft()}
                    onClose={() => setTranslateOpen(false)}
                  />
                )}
              </span>
            )}
            {text.trim() && !pendingFiles.length && (
              <span className="emoji-anchor">
                <button
                  className={`icon-btn ${scheduleOpen ? 'active' : ''}`}
                  onMouseDown={(e) => scheduleOpen && e.stopPropagation()}
                  onClick={() => setScheduleOpen((o) => !o)}
                  title={t('scheduleSend')}
                  disabled={disabled}
                >
                  <AlarmClock size={18} strokeWidth={2} />
                </button>
                {scheduleOpen && <SchedulePicker onPick={scheduleCurrent} onClose={() => setScheduleOpen(false)} />}
              </span>
            )}
            <button
              className={`composer-send visible ${canSend ? '' : 'idle'}`}
              onClick={submit}
              onContextMenu={(e) => {
                if (!text.trim() || pendingFiles.length) return
                e.preventDefault()
                setScheduleOpen(true)
              }}
              title={t('send')}
              disabled={!canSend}
            >
              <ArrowUp size={18} strokeWidth={2.6} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
