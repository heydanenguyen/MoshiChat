import { useState } from 'react'
import { AlertTriangle, ArchiveRestore, Eye, EyeOff, FileArchive, FolderOpen, Lock, ShieldCheck, X } from 'lucide-react'
import type { BackupInfo } from '@shared/types'
import { useStore, useT } from '../store'
import { formatBytes } from '../utils'
import { BuddyLoader } from './BuddyLoader'
import { LogoMark } from './Logo'

function PasswordField({ value, onChange, placeholder, autoFocus, onEnter }: { value: string; onChange(v: string): void; placeholder: string; autoFocus?: boolean; onEnter?(): void }): JSX.Element {
  const t = useT()
  const [shown, setShown] = useState(false)
  return (
    <span className="password-field">
      <Lock size={14} strokeWidth={2.3} />
      <input
        className="field-input"
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="new-password"
        spellCheck={false}
      />
      <button type="button" className="icon-btn" onClick={() => setShown((v) => !v)} title={shown ? t('passwordHide') : t('passwordShow')}>
        {shown ? <EyeOff size={15} strokeWidth={2.2} /> : <Eye size={15} strokeWidth={2.2} />}
      </button>
    </span>
  )
}

/** Backup to an encrypted file, or restore one (replaces this device's data, then Moshi restarts). */
export function BackupSheet({ mode }: { mode: 'create' | 'restore' }): JSX.Element {
  const t = useT()
  const closeSheet = useStore((s) => s.closeSheet)
  const language = useStore((s) => s.settings.language)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [includeSessions, setIncludeSessions] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [done, setDone] = useState<{ path: string; bytes: number } | undefined>()
  const [file, setFile] = useState<BackupInfo | undefined>()
  const [restarting, setRestarting] = useState(false)

  const explain = (err: unknown): string => {
    const message = (err as Error).message ?? ''
    if (message.includes('BACKUP_PASSWORD')) return t('backupWrongPassword')
    if (message.includes('BACKUP_FORMAT')) return t('backupBadFile')
    return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  }

  const create = async (): Promise<void> => {
    if (password.length < 8 || password !== confirm || busy) return
    setBusy(true)
    setError(undefined)
    try {
      const result = await window.unison.backup.create({ password, includeSessions })
      if (result) setDone(result)
    } catch (err) {
      setError(explain(err))
    } finally {
      setBusy(false)
    }
  }

  const pick = async (): Promise<void> => {
    setError(undefined)
    try {
      const info = await window.unison.backup.pick()
      if (info) setFile(info)
    } catch (err) {
      setError(explain(err))
    }
  }

  const restore = async (): Promise<void> => {
    if (!file || !password || busy) return
    setBusy(true)
    setError(undefined)
    try {
      await window.unison.backup.restore({ path: file.path, password })
      setRestarting(true)
    } catch (err) {
      setError(explain(err))
      setBusy(false)
    }
  }

  const when = (ts: number): string =>
    new Date(ts).toLocaleString(language === 'vi' ? 'vi-VN' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  let body: JSX.Element
  if (restarting) {
    body = (
      <div className="backup-state">
        <BuddyLoader size={64} label={t('backupRestarting')} />
      </div>
    )
  } else if (mode === 'create' && done) {
    body = (
      <div className="backup-state">
        <span className="backup-badge ok">
          <ShieldCheck size={26} strokeWidth={2.2} />
        </span>
        <strong>{t('backupDone')}</strong>
        <span className="backup-path" title={done.path}>
          {done.path.split(/[\\/]/).pop()} · {formatBytes(done.bytes)}
        </span>
        <span className="backup-hint">{t('backupKeepSafe')}</span>
        <div className="backup-actions">
          <button className="btn" onClick={() => void window.unison.backup.reveal(done.path)}>
            <FolderOpen size={15} strokeWidth={2.2} /> {t('backupReveal')}
          </button>
          <button className="btn primary" onClick={closeSheet}>
            {t('done')}
          </button>
        </div>
      </div>
    )
  } else if (mode === 'create') {
    const mismatch = confirm.length > 0 && confirm !== password
    body = (
      <div className="backup-form">
        <div className="backup-intro">
          <LogoMark size={52} title="" className="backup-buddy" />
          <span>{t('backupIntro')}</span>
        </div>
        <label className="field">
          <span className="field-label">{t('backupPassword')}</span>
          <PasswordField value={password} onChange={setPassword} placeholder={t('backupPasswordHint')} autoFocus />
        </label>
        <label className="field">
          <span className="field-label">{t('backupPasswordConfirm')}</span>
          <PasswordField value={confirm} onChange={setConfirm} placeholder={t('backupPasswordConfirmHint')} onEnter={() => void create()} />
          {mismatch && <span className="field-error">{t('backupPasswordMismatch')}</span>}
        </label>
        <div className="settings-row backup-toggle">
          <div className="settings-row-text">
            <div className="settings-row-title">{t('backupIncludeSessions')}</div>
            <div className="settings-row-sub">{t('backupIncludeSessionsHint')}</div>
          </div>
          <button className={`switch ${includeSessions ? 'on' : ''}`} role="switch" aria-checked={includeSessions} onClick={() => setIncludeSessions((v) => !v)} />
        </div>
        <div className="backup-warning">
          <AlertTriangle size={15} strokeWidth={2.3} />
          {t('backupNoRecovery')}
        </div>
        {error && <div className="error-banner">{error}</div>}
        <div className="backup-actions">
          <button className="btn" onClick={closeSheet}>
            {t('cancel')}
          </button>
          <button className="btn primary" onClick={() => void create()} disabled={busy || password.length < 8 || password !== confirm}>
            {busy ? <BuddyLoader size={18} inline /> : <FileArchive size={15} strokeWidth={2.2} />} {t('backupCreate')}
          </button>
        </div>
      </div>
    )
  } else {
    body = (
      <div className="backup-form">
        <div className="backup-intro">
          <LogoMark size={52} title="" className="backup-buddy" />
          <span>{t('restoreIntro')}</span>
        </div>
        <button className={`backup-file ${file ? 'picked' : ''}`} onClick={() => void pick()} disabled={busy}>
          <span className="backup-file-icon">
            <FileArchive size={20} strokeWidth={2.1} />
          </span>
          {file ? (
            <span className="backup-file-text">
              <strong>{file.path.split(/[\\/]/).pop()}</strong>
              <span>
                {t('restoreMadeOn', { date: when(file.createdAt) })} · {formatBytes(file.bytes)} · {file.includesSessions ? t('restoreWithSessions') : t('restoreWithoutSessions')}
              </span>
            </span>
          ) : (
            <span className="backup-file-text">
              <strong>{t('restoreChoose')}</strong>
              <span>.unisonbackup</span>
            </span>
          )}
        </button>
        {file && (
          <>
            <label className="field">
              <span className="field-label">{t('backupPassword')}</span>
              <PasswordField value={password} onChange={setPassword} placeholder={t('restorePasswordHint')} autoFocus onEnter={() => void restore()} />
            </label>
            <div className="backup-warning">
              <AlertTriangle size={15} strokeWidth={2.3} />
              {t('restoreWarning')}
            </div>
          </>
        )}
        {error && <div className="error-banner">{error}</div>}
        <div className="backup-actions">
          <button className="btn" onClick={closeSheet} disabled={busy}>
            {t('cancel')}
          </button>
          <button className="btn primary" onClick={() => void restore()} disabled={!file || !password || busy}>
            {busy ? <BuddyLoader size={18} inline /> : <ArchiveRestore size={15} strokeWidth={2.2} />} {t('restoreAction')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && closeSheet()}>
      <div className="sheet backup-sheet" role="dialog" aria-label={mode === 'create' ? t('backupTitle') : t('restoreTitle')}>
        <div className="sheet-header">
          <div className="sheet-title">{mode === 'create' ? t('backupTitle') : t('restoreTitle')}</div>
          <button className="icon-btn" onClick={closeSheet} title={t('close')} disabled={busy}>
            <X size={16} strokeWidth={2.4} />
          </button>
        </div>
        <div className="sheet-body scroll">{body}</div>
      </div>
    </div>
  )
}
