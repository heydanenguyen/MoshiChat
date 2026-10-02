import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Image as ImageIcon, ImagePlus, Palette, Pencil, RotateCcw, Shuffle } from 'lucide-react'
import { abstractChoices, abstractId, abstractIdUrl, parseAbstractId } from './AbstractAvatar'
import { palPickId, palPickUrl, palPicks, parsePalPickId } from '@shared/pals-art'
import type { ContactOverride, Conversation } from '@shared/types'
import { LOGOS, LOGO_ORDER } from '@shared/logos'
import { bubbleVarsOf, customAvatarUrl, useStore, useT } from '../store'
import { Avatar } from './Avatar'
import { LogoMark } from './Logo'
import { BubbleColorRow } from './BubbleColorRow'
import { WallpaperRow, useWallpaper } from './Wallpaper'
import { BirthdayPicker } from './BirthdayPicker'

/** The sets of looks the photo picker shows, one at a time. */
const LOOK_SETS = ['photo', 'moshi', 'abstract', 'pals'] as const
type LookSet = (typeof LOOK_SETS)[number]
const setOf = (avatar?: string): LookSet =>
  avatar?.startsWith('logo:') ? 'moshi' : avatar?.startsWith('abstract:') ? 'abstract' : avatar?.startsWith('pal:') ? 'pals' : 'photo'

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
  // Abstract characters: the name's own one first, then a fresh spread each time "another set" is pressed.
  const [round, setRound] = useState(0)
  const [palRound, setPalRound] = useState(0)
  const language = useStore((s) => s.settings.language)
  const fileInput = useRef<HTMLInputElement>(null)
  const ref = useRef<HTMLDivElement>(null)
  const originalName = conversation.originalTitle ?? conversation.title
  const originalAvatar = 'originalAvatarUrl' in conversation ? conversation.originalAvatarUrl : conversation.avatarUrl

  // Every change is saved as it is made (like the colour and wallpaper always were); how things were when the
  // editor opened is kept, so Undo can put all of it back.
  const opened = useRef(override)
  const patch = (fields: Partial<ContactOverride>): void => {
    const current = useStore.getState().settings.contactOverrides?.[conversation.id]
    void setContactOverride(conversation.id, { ...current, ...fields })
  }
  const nameRef = useRef(nickname)
  nameRef.current = nickname
  const commitName = useCallback((): void => {
    const name = nameRef.current.trim()
    const current = useStore.getState().settings.contactOverrides?.[conversation.id]
    if (name !== (current?.nickname ?? '')) void setContactOverride(conversation.id, { ...current, nickname: name || undefined })
  }, [conversation.id, setContactOverride])
  const pickAvatar = (value: string | undefined): void => {
    setAvatar(value)
    patch({ avatar: value })
  }
  const done = useCallback((): void => {
    commitName()
    onClose()
  }, [commitName, onClose])
  const changed = JSON.stringify(override ?? {}) !== JSON.stringify(opened.current ?? {}) || nickname.trim() !== (override?.nickname ?? '')
  const undo = (): void => {
    void setContactOverride(conversation.id, opened.current)
    setNickname(opened.current?.nickname ?? '')
    setAvatar(opened.current?.avatar)
  }

  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'start' })
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') done()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [done])
  // Leaving another way (another chat, the pane closing) still keeps a typed name.
  useEffect(() => () => commitName(), [commitName])

  const reset = (): void => {
    // Looks go back to the platform's; your notes about them stay. Undo still brings them back.
    void setContactOverride(conversation.id, override?.note ? { note: override.note, noteAt: override.noteAt } : undefined)
    setNickname('')
    setAvatar(undefined)
  }

  const upload = async (file?: File): Promise<void> => {
    if (!file) return
    try {
      pickAvatar(await toAvatarDataUrl(file))
    } catch (err) {
      showToast((err as Error).message, 'error')
    }
  }

  // The set shown under the photo: the one the current pick belongs to, so it is in view on opening.
  const [set, setSet] = useState<LookSet>(() => setOf(override?.avatar))
  const shuffle = set === 'abstract' ? () => setRound((r) => r + 1) : set === 'pals' ? () => setPalRound((r) => r + 1) : undefined
  const customAccents = useStore((s) => s.settings.customAccents)
  const bubbleVars = bubbleVarsOf(override?.bubble, customAccents)
  const wallpaper = useWallpaper(conversation.id)
  const choice = (id: string, label: string, art: JSX.Element): JSX.Element => (
    <button key={id} className={`avatar-choice ${avatar === id ? 'active' : ''}`} role="radio" aria-checked={avatar === id} onClick={() => pickAvatar(id)} title={label}>
      {art}
    </button>
  )

  return (
    <div className="contact-customizer" ref={ref} role="dialog" aria-label={t('customize')}>
      <div className="cz-bar">
        <span className="cz-title">
          <strong>{t('customize')}</strong>
          <span>{t('customizeOnlyYou')}</span>
        </span>
        <button className="btn primary small" onClick={done}>
          {t('done')}
        </button>
      </div>

      {/* The stage: this chat in miniature, with its wallpaper and bubble colour, so every change shows where it counts. */}
      <div className={`cz-stage ${wallpaper.attr ? 'has-wallpaper' : ''}`} style={{ ...bubbleVars, ...wallpaper.style }}>
        {wallpaper.attr && <div className="chat-wallpaper" data-wallpaper={wallpaper.attr} aria-hidden />}
        <span className="cz-avatar" key={avatar ?? 'original'}>
          <Avatar name={nickname || originalName} url={customAvatarUrl(avatar) ?? originalAvatar} size={76} />
        </span>
        <label className="cz-name">
          <input
            value={nickname}
            placeholder={originalName}
            maxLength={60}
            aria-label={t('nickname')}
            onChange={(e) => setNickname(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <Pencil size={12} strokeWidth={2.4} aria-hidden />
        </label>
        <span className="cz-original">{nickname.trim() ? t('originalName', { name: originalName }) : t('nicknameHint')}</span>
        <span className="cz-sample" aria-hidden>
          <span className="bubble in">{t('customizeSampleIn')}</span>
          <span className="bubble out">{t('customizeSampleOut')}</span>
        </span>
      </div>

      <div className="cz-section">
        <div className="cz-sets">
          <div className="cz-tabs" role="tablist" aria-label={t('customPhoto')}>
            {LOOK_SETS.map((s) => (
              <button key={s} role="tab" aria-selected={set === s} className={set === s ? 'active' : ''} onClick={() => setSet(s)}>
                {s === 'photo' ? t('lookPhoto') : s === 'abstract' ? t('lookAbstract') : s === 'moshi' ? 'Moshi' : 'Pals'}
              </button>
            ))}
          </div>
          <button
            className="icon-btn cz-shuffle"
            onClick={shuffle}
            disabled={!shuffle}
            title={set === 'pals' ? t('avatarPalsShuffle') : t('avatarShuffle')}
            aria-label={set === 'pals' ? t('avatarPalsShuffle') : t('avatarShuffle')}
          >
            <Shuffle size={15} strokeWidth={2.3} />
          </button>
        </div>
        <div className="avatar-choices cz-grid" role="radiogroup" aria-label={t('customPhoto')}>
          {set === 'photo' && (
            <>
              <button className={`avatar-choice ${!avatar ? 'active' : ''}`} role="radio" aria-checked={!avatar} onClick={() => pickAvatar(undefined)} title={t('photoOriginal')}>
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
            </>
          )}
          {set === 'moshi' &&
            LOGO_ORDER.map((id) =>
              choice(
                `logo:${id}`,
                LOGOS[id].name[language],
                <span className="avatar-choice-logo" style={{ background: LOGOS[id].background }}>
                  <LogoMark logo={id} size={30} title="" />
                </span>
              )
            )}
          {set === 'abstract' &&
            (() => {
              const choices = abstractChoices(originalName, round)
              // Keep the picked character in view even after the set changes.
              const picked = avatar && parseAbstractId(avatar)
              if (picked && !choices.some((p) => abstractId(p) === avatar)) choices.splice(1, 0, picked)
              return choices.map((p) => choice(abstractId(p), t('lookAbstract'), <img className="avatar-choice-abstract" src={abstractIdUrl(abstractId(p))} alt="" draggable={false} />))
            })()}
          {set === 'pals' &&
            (() => {
              const picks = palPicks(originalName, palRound)
              const picked = avatar && parsePalPickId(avatar)
              if (picked && !picks.some((p) => palPickId(p) === avatar)) picks.splice(1, 0, picked)
              return picks.map((p) => choice(palPickId(p), p.member.name[language], <img className="avatar-choice-abstract" src={palPickUrl(palPickId(p))} alt="" draggable={false} />))
            })()}
        </div>
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => void upload(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
      </div>

      <div className="cz-section">
        <div className="cz-label">{t('customizeInChat')}</div>
        <div className="cz-row">
          <span className="cz-row-label">
            <Palette size={13} strokeWidth={2.2} /> {t('bubbleColor')}
          </span>
          <BubbleColorRow conversationId={conversation.id} />
        </div>
        <div className="cz-row">
          <span className="cz-row-label">
            <ImageIcon size={13} strokeWidth={2.2} /> {t('wallpaper')}
          </span>
          <WallpaperRow conversationId={conversation.id} />
        </div>
      </div>

      <BirthdayPicker value={override?.birthday} onChange={(birthday) => patch({ birthday })} />

      {/* Quiet and last: it clears every look you gave this person (Undo still brings them back). */}
      {override && (
        <button className="cz-reset" onClick={reset}>
          <RotateCcw size={13} strokeWidth={2.4} />
          {t('customReset')}
        </button>
      )}

      <div className={`cz-undo ${changed ? 'shown' : ''}`} role="status" aria-hidden={!changed}>
        <Check size={14} strokeWidth={2.6} />
        <span>{t('customizeSaved')}</span>
        <button onClick={undo} tabIndex={changed ? 0 : -1}>
          {t('undo')}
        </button>
      </div>
    </div>
  )
}
