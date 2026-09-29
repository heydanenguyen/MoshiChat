import { Volume1, Volume2 } from 'lucide-react'
import type { SoundId } from '@shared/types'
import { useStore, useT } from '../store'
import { SOUND_IDS, SOUND_NAMES, playSent, playSound } from '../sounds'
import { SOUND_TINTS, SoundArt } from './SoundArt'

/** Settings: pick the message sound (each tile plays itself), volume and the send whoosh. */
export function SoundSettings(): JSX.Element {
  const t = useT()
  const language = useStore((s) => s.settings.language)
  const sound = useStore((s) => s.settings.sound ?? 'bubbles')
  const volume = useStore((s) => s.settings.soundVolume ?? 0.7)
  const sendSound = useStore((s) => s.settings.sendSound !== false)
  const setSettings = useStore((s) => s.setSettings)

  const choose = (id: SoundId | 'off'): void => {
    void setSettings({ sound: id })
    if (id !== 'off') playSound(id, volume)
  }

  return (
    <>
      <div className="settings-row" style={{ alignItems: 'flex-start' }}>
        <div className="settings-row-text">
          <div className="settings-row-title">{t('sound')}</div>
          <div className="settings-row-sub">{t('soundHint')}</div>
          <div className="sound-picker" role="radiogroup" aria-label={t('sound')}>
            {[...SOUND_IDS, 'off' as const].map((id) => (
              <button key={id} role="radio" aria-checked={sound === id} className={`sound-tile ${sound === id ? 'active' : ''} ${id === 'off' ? 'off' : ''}`} onClick={() => choose(id)}>
                <span className="sound-emoji" aria-hidden style={{ background: SOUND_TINTS[id] }}>
                  <SoundArt id={id} size={32} />
                </span>
                <span className="sound-name">{SOUND_NAMES[id][language]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      {sound !== 'off' && (
        <>
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-title">{t('soundVolume')}</div>
            </div>
            <div className="sound-volume">
              <Volume1 size={15} strokeWidth={2.2} />
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={volume}
                style={{ ['--fill' as string]: `${Math.round(((volume - 0.1) / 0.9) * 100)}%` }}
                onChange={(e) => void setSettings({ soundVolume: Number(e.target.value) })}
                onPointerUp={(e) => playSound(sound, Number((e.target as HTMLInputElement).value))}
                aria-label={t('soundVolume')}
              />
              <Volume2 size={15} strokeWidth={2.2} />
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-title">{t('sendSound')}</div>
            </div>
            <button
              className={`switch ${sendSound ? 'on' : ''}`}
              role="switch"
              aria-checked={sendSound}
              onClick={() => {
                void setSettings({ sendSound: !sendSound })
                if (!sendSound) playSent(volume)
              }}
            />
          </div>
        </>
      )}
    </>
  )
}
