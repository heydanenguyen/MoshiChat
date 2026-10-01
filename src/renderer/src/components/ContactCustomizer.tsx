import { useEffect, useRef, useState } from 'react'
import { Cake, Image as ImageIcon, ImagePlus, Palette, RotateCcw, Shuffle, X } from 'lucide-react'
import { abstractChoices, abstractId, abstractIdUrl, parseAbstractId } from './AbstractAvatar'
import type { Conversation } from '@shared/types'
import { LOGOS, LOGO_ORDER } from '@shared/logos'
import { parseBirthday } from '@shared/extras'
import { customAvatarUrl, useStore, useT } from '../store'
import { Avatar } from './Avatar'
import { LogoMark } from './Logo'
import { BubbleColorRow } from './BubbleColorRow'
import { WallpaperRow } from './Wallpaper'

/** Square-crop and shrink an image file to a small WebP data URL (kept in settings). */
async function toAvatarDataUrl(file: File, size = 256): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('Not an image'))
      i.src = url
    })
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size)
    return canvas.toDataURL('image/webp', 0.9)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Nickname, custom photo (upload or a Moshi character) and birthday for one conversation.
 * Only Moshi shows them; nothing is sent to the platform.
 */
export function ContactCustomizer({ conversation, onClose }: { conversation: Conversation; onClose(): void }): JSX.Element {
  const t = useT()
  const override = useStore((s) => s.settings.contactOverrides?.[conversation.id])
  const setContactOverride = useStore((s) => s.setContactOverride)
  const showToast = useStore((s) => s.showToast)
  const [nickname, setNickname] = useState(override?.nickname ?? '')
  const [avatar, setAvatar] = useState<string | undefined>(override?.avatar)
  // Day and month are enough for a reminder; the year is optional (a stored --MM-DD keeps working).
  const stored = parseBirthday(override?.birthday)
  const [bDay, setBDay] = useState(stored ? String(stored.day) : '')
  const [bMonth, setBMonth] = useState(stored ? String(stored.month) : '')
  const [bYear, setBYear] = useState(stored?.year ? String(stored.year) : '')
  const pad = (n: string): string => n.padStart(2, '0')
  const yearOk = !bYear || (/^\d{4}$/.test(bYear) && Number(bYear) >= 1900 && Number(bYear) <= new Date().getFullYear())
  const birthday = bDay && bMonth && yearOk ? `${bYear ? bYear : '-'}-${pad(bMonth)}-${pad(bDay)}` : ''
  const [busy, setBusy] = useState(false)
  // Abstract characters: the name's own one first, then a fresh spread each time "another set" is pressed.
  const [round, setRound] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const ref = useRef<HTMLDivElement>(null)
  const originalName = conversation.originalTitle ?? conversation.title
  const originalAvatar = 'originalAvatarUrl' in conversation ? conversation.originalAvatarUrl : conversation.avatarUrl

  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await setContactOverride(conversation.id, { ...override, nickname, avatar, birthday: birthday || undefined })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const reset = async (): Promise<void> => {
    // Looks go back to the platform's; your notes about them stay.
    await setContactOverride(conversation.id, override?.note ? { note: override.note, noteAt: override.noteAt } : undefined)
    onClose()
  }

  const upload = async (file?: File): Promise<void> => {
    if (!file) return
    try {
      setAvatar(await toAvatarDataUrl(file))
    } catch (err) {
      showToast((err as Error).message, 'error')
    }
  }

  return (
    <div className="contact-customizer" ref={ref} role="dialog" aria-label={t('customize')}>
      <div className="contact-customizer-head">
        <span className="contact-customizer-title">{t('customize')}</span>
        <button className="icon-btn" onClick={onClose} title={t('close')}>
          <X size={15} strokeWidth={2.4} />
        </button>
      </div>
      <div className="contact-customizer-preview">
        <Avatar name={nickname || originalName} url={customAvatarUrl(avatar) ?? originalAvatar} size={56} />
        <span className="contact-customizer-preview-text">
          <strong>{nickname.trim() || originalName}</strong>
          {nickname.trim() && <span>{t('originalName', { name: originalName })}</span>}
        </span>
      </div>

      <label className="field">
        <span className="field-label">{t('nickname')}</span>
        <input
          className="field-input"
          value={nickname}
          placeholder={originalName}
          maxLength={60}
          onChange={(e) => setNickname(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
        />
      </label>

      <div className="field">
        <span className="field-label">{t('customPhoto')}</span>
        <div className="avatar-choices" role="radiogroup" aria-label={t('customPhoto')}>
          <button className={`avatar-choice ${!avatar ? 'active' : ''}`} role="radio" aria-checked={!avatar} onClick={() => setAvatar(undefined)} title={t('photoOriginal')}>
            <Avatar name={originalName} url={originalAvatar} size={40} />
          </button>
          {avatar?.startsWith('data:') && (
            <button className="avatar-choice active" role="radio" aria-checked title={t('photoUpload')}>
              <Avatar name={originalName} url={avatar} size={40} />
            </button>
          )}
          <button className="avatar-choice upload" onClick={() => fileInput.current?.click()} title={t('photoUpload')}>
            <ImagePlus size={17} strokeWidth={2.2} />
          </button>
          {LOGO_ORDER.map((id) => (
            <button
              key={id}
              className={`avatar-choice ${avatar === `logo:${id}` ? 'active' : ''}`}
              role="radio"
              aria-checked={avatar === `logo:${id}`}
              onClick={() => setAvatar(`logo:${id}`)}
              title={LOGOS[id].name.vi}
            >
              <span className="avatar-choice-logo" style={{ background: LOGOS[id].background }}>
                <LogoMark logo={id} size={30} title="" />
              </span>
            </button>
          ))}
        </div>
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => void upload(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
      </div>

      <div className="field">
        <span className="field-label">{t('avatarAbstract')}</span>
        <div className="avatar-choices" role="radiogroup" aria-label={t('avatarAbstract')}>
          {(() => {
            const choices = abstractChoices(originalName, round)
            // Keep the picked character in view even after the set changes.
            const picked = avatar && parseAbstractId(avatar)
            if (picked && !choices.some((p) => abstractId(p) === avatar)) choices.splice(1, 0, picked)
            return choices.map((p) => {
              const id = abstractId(p)
              return (
                <button key={id} className={`avatar-choice ${avatar === id ? 'active' : ''}`} role="radio" aria-checked={avatar === id} onClick={() => setAvatar(id)} title={t('avatarAbstract')}>
                  <img className="avatar-choice-abstract" src={abstractIdUrl(id)} alt="" draggable={false} />
                </button>
              )
            })
          })()}
          <button className="avatar-choice upload" onClick={() => setRound((r) => r + 1)} title={t('avatarShuffle')}>
            <Shuffle size={17} strokeWidth={2.2} />
          </button>
        </div>
        <span className="field-hint">{t('avatarAbstractHint')}</span>
      </div>

      <label className="field">
        <span className="field-label">
          <Cake size={13} strokeWidth={2.2} /> {t('birthday')}
        </span>
        <span className="field-row birthday-row">
          <select className="field-input" value={bDay} onChange={(e) => setBDay(e.target.value)} aria-label={t('birthdayDay')}>
            <option value="">{t('birthdayDay')}</option>
            {Array.from({ length: 31 }, (_, i) => (
              <option key={i} value={String(i + 1)}>
                {i + 1}
              </option>
            ))}
          </select>
          <select className="field-input" value={bMonth} onChange={(e) => setBMonth(e.target.value)} aria-label={t('birthdayMonth')}>
            <option value="">{t('birthdayMonth')}</option>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={String(i + 1)}>
                {t('birthdayMonthN', { n: String(i + 1) })}
              </option>
            ))}
          </select>
          <input
            className="field-input birthday-year"
            inputMode="numeric"
            maxLength={4}
            placeholder={t('birthdayYearOptional')}
            aria-label={t('birthdayYearOptional')}
            aria-invalid={!yearOk}
            value={bYear}
            onChange={(e) => setBYear(e.target.value.replace(/\D/g, ''))}
          />
          {(bDay || bMonth || bYear) && (
            <button
              className="icon-btn"
              onClick={() => {
                setBDay('')
                setBMonth('')
                setBYear('')
              }}
              title={t('clear')}
            >
              <X size={14} strokeWidth={2.4} />
            </button>
          )}
        </span>
        <span className={`field-hint ${yearOk ? '' : 'error'}`}>{yearOk ? t('birthdayHint') : t('birthdayYearInvalid')}</span>
      </label>

      <div className="field customizer-looks">
        <span className="field-label">
          <Palette size={13} strokeWidth={2.2} /> {t('bubbleColor')}
        </span>
        <BubbleColorRow conversationId={conversation.id} />
      </div>
      <div className="field customizer-looks">
        <span className="field-label">
          <ImageIcon size={13} strokeWidth={2.2} /> {t('wallpaper')}
        </span>
        <WallpaperRow conversationId={conversation.id} />
        <span className="field-hint">{t('looksInstantHint')}</span>
      </div>

      <div className="contact-customizer-actions">
        {override && (
          <button className="btn secondary" onClick={() => void reset()} title={t('customReset')}>
            <RotateCcw size={14} strokeWidth={2.4} />
            {t('customReset')}
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn secondary" onClick={onClose}>
          {t('cancel')}
        </button>
        <button className="btn primary" onClick={() => void save()} disabled={busy}>
          {t('customSave')}
        </button>
      </div>
      <div className="field-hint centered">{t('customizeHint')}</div>
    </div>
  )
}
