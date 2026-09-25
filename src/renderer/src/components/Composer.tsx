import { useEffect, useRef, useState } from 'react'
import { ArrowUp, File, Paperclip, Reply, X } from 'lucide-react'
import { useStore, useT } from '../store'
import { formatBytes } from '../utils'

interface Props {
  disabled?: boolean
  canAttach: boolean
}

export function Composer({ disabled, canAttach }: Props): JSX.Element {
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
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setText('')
    ref.current?.focus()
  }, [selectedId])

  useEffect(() => {
    if (replyTo) ref.current?.focus()
  }, [replyTo])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text])

  const submit = (): void => {
    if ((!text.trim() && !pendingFiles.length) || disabled) return
    void send(text)
    setText('')
    ref.current?.focus()
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
    ref.current?.focus()
  }

  const canSend = (text.trim().length > 0 || pendingFiles.length > 0) && !disabled

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
              {file.preview ? (
                <img src={file.preview} alt="" draggable={false} />
              ) : (
                <span className="pending-file-icon">
                  <File size={16} />
                </span>
              )}
              <span className="pending-file-text">
                <span className="pending-file-name">{file.name}</span>
                <span className="pending-file-meta">{formatBytes(file.size)}</span>
              </span>
              <button className="pending-file-remove" onClick={() => removeFile(file.path)} title={t('remove')}>
                <X size={11} strokeWidth={3} />
              </button>
            </div>
          ))}
        </div>
      )}
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
        <button className={`composer-send ${canSend ? 'visible' : ''}`} onClick={submit} title={t('send')} tabIndex={canSend ? 0 : -1}>
          <ArrowUp size={18} strokeWidth={2.6} />
        </button>
      </div>
    </div>
  )
}
