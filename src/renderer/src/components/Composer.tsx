import { useEffect, useRef, useState } from 'react'
import { ArrowUp, File, Mic, Paperclip, Reply, Smile, Sticker, Trash2, X } from 'lucide-react'
import { useStore, useT } from '../store'
import { formatBytes } from '../utils'
import { EmojiPicker } from './EmojiPicker'
import { StickerPicker } from './StickerPicker'

interface Props {
  disabled?: boolean
  canAttach: boolean
  canVoice?: boolean
}

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

export function Composer({ disabled, canAttach, canVoice = canAttach }: Props): JSX.Element {
  const t = useT()
  const send = useStore((s) => s.send)
  const notifyTyping = useStore((s) => s.notifyTyping)
  const sendOnEnter = useStore((s) => s.settings.sendOnEnter)
  const selectedId = useStore((s) => s.selectedId)
  const replyTo = useStore((s) => s.replyTo)
  const setReplyTo = useStore((s) => s.setReplyTo)
  const pendingFiles = useStore((s) => s.pendingFiles)
  const addFiles = useStore((s) => s.addFiles)
  const addDroppedFiles = useStore((s) => s.addDroppedFiles)
  const removeFile = useStore((s) => s.removeFile)
  const showToast = useStore((s) => s.showToast)
  const [text, setText] = useState('')
  const [recording, setRecording] = useState<Recording | undefined>()
  const [elapsed, setElapsed] = useState(0)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [stickersOpen, setStickersOpen] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  const focusInput = (): void => ref.current?.focus({ preventScroll: true })

  useEffect(() => {
    setText('')
    setEmojiOpen(false)
    focusInput()
  }, [selectedId])

  useEffect(() => {
    if (replyTo) focusInput()
  }, [replyTo])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text])

  useEffect(() => {
    if (!recording) return
    const timer = setInterval(() => setElapsed((Date.now() - recording.startedAt) / 1000), 200)
    return () => clearInterval(timer)
  }, [recording])

  const submit = (): void => {
    if ((!text.trim() && !pendingFiles.length) || disabled) return
    void send(text)
    setText('')
    focusInput()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Escape' && replyTo) {
      setReplyTo(undefined)
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
      addDroppedFiles(files)
    }
  }

  const pick = async (): Promise<void> => {
    const files = await window.unison.app.pickFiles()
    if (files.length) addFiles(files)
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
        await send('', [voice])
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
          <button className="icon-btn" onClick={() => setReplyTo(undefined)} title={t('cancelReply')}>
            <X size={14} strokeWidth={2.4} />
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
              <button className="pending-file-remove" onClick={() => removeFile(file.path)} title={t('remove')}>
                <X size={11} strokeWidth={3} />
              </button>
            </div>
          ))}
        </div>
      )}
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
              if (e.target.value) notifyTyping()
            }}
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
                          await send('', [await window.unison.app.sticker(id)])
                        } catch (err) {
                          showToast((err as Error).message, 'error')
                        }
                      })()
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
            <button className={`composer-send visible ${canSend ? '' : 'idle'}`} onClick={submit} title={t('send')} disabled={!canSend}>
              <ArrowUp size={18} strokeWidth={2.6} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
