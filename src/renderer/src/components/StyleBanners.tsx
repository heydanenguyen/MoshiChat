import { Check } from 'lucide-react'
import { STYLES, type StyleId } from '@shared/types'
import { logoHero, type LogoId } from '@shared/logos'
import { castById, specOf } from '@shared/pals-art'
import { useStore, useT } from '../store'
import { LogoMark } from './Logo'
import { Pal } from './Pals'

/** The Buddies duo, whatever logo is picked: they are the Moshi style's characters. */
function Duo(): JSX.Element {
  const hero = logoHero('buddies')
  return <svg className="sb-duo" viewBox={hero.viewBox} aria-hidden dangerouslySetInnerHTML={{ __html: hero.inner }} />
}

const GIANT_HOA = specOf(castById('hoa'), 'joy')
const DOCK: LogoId[] = ['curious', 'sunny', 'blossom', 'grape']

/** Each style's own little world: its materials, its type and its characters. */
function Art({ id, hello }: { id: StyleId; hello: string }): JSX.Element {
  // Moshi: the name itself, giant and white, as a poster behind the Buddies
  if (id === 'moshi')
    return (
      <span className="sb-art" aria-hidden>
        <b className="sb-giant">moshi</b>
        <Duo />
      </span>
    )
  // Liquid Glass: a glass dock on a soft wallpaper, a Moshi character on each glass tile
  if (id === 'liquid')
    return (
      <span className="sb-art" aria-hidden>
        <i className="sb-wall" />
        <span className="sb-dock">
          {DOCK.map((logo) => (
            <span key={logo} className="sb-tile">
              <LogoMark logo={logo} size={24} title="" />
            </span>
          ))}
        </span>
      </span>
    )
  // Mono: a tuner's face, its numerals and dial in greys and the needle in the accent
  if (id === 'mono')
    return (
      <span className="sb-art" aria-hidden>
        <span className="sb-mono-num">
          <i>0</i>94
        </span>
        <span className="sb-mono-ruler" />
      </span>
    )
  // Pals: one giant pal spilling out of the frame, saying hello in ink
  return (
    <span className="sb-art" aria-hidden>
      <Pal spec={GIANT_HOA} size={150} className="sb-pal giant" />
      <span className="sb-say">{hello}</span>
    </span>
  )
}

/** The style picker as three small banners in a row, one per style, each drawn in its own look. */
export function StyleBanners(): JSX.Element {
  const t = useT()
  const style = useStore((s) => s.settings.style ?? 'moshi')
  const language = useStore((s) => s.settings.language)
  const setSettings = useStore((s) => s.setSettings)
  return (
    <div className="style-banners" role="radiogroup" aria-label={t('style')}>
      {STYLES.map((s) => {
        const active = style === s.id
        return (
          <button key={s.id} className={`style-banner sb-${s.id} ${active ? 'active' : ''}`} role="radio" aria-checked={active} onClick={() => void setSettings({ style: s.id })}>
            <Art id={s.id} hello={language === 'vi' ? 'Chào~' : 'Hello~'} />
            <span className="sb-text">
              <span className="sb-name">{s.name[language]}</span>
              <span className="sb-sub">{s.sub[language]}</span>
            </span>
            {active && (
              <span className="sb-check" aria-hidden>
                <Check size={13} strokeWidth={3} />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
