import { useMemo, useRef, type CSSProperties } from 'react'
import { ImagePlus } from 'lucide-react'
import { LOGOS, logoMarkInner, type LogoId } from '@shared/logos'
import { WALLPAPERS, isWallpaperPreset, type WallpaperPreset } from '@shared/extras'
import { useStore, useT } from '../store'

const NAMES: Record<WallpaperPreset, { vi: string; en: string }> = {
  peach: { vi: 'Đào', en: 'Peach' },
  mint: { vi: 'Bạc hà', en: 'Mint' },
  lilac: { vi: 'Tím nhạt', en: 'Lilac' },
  sunset: { vi: 'Hoàng hôn', en: 'Sunset' },
  night: { vi: 'Đêm sao', en: 'Starry night' },
  dots: { vi: 'Chấm bi', en: 'Polka dots' },
  hearts: { vi: 'Trái tim', en: 'Hearts' },
  bubbles: { vi: 'Bong bóng', en: 'Bubbles' },
  buddies: { vi: 'Bộ đôi', en: 'Buddies' }
}

/** A tile of the chosen logo character, scattered and tilted, for the "buddies" wallpaper. */
function buddiesPattern(logo: LogoId): string {
  const mark = (x: number, y: number, size: number, rotate: number, opacity: number): string =>
    `<g transform="translate(${x} ${y}) rotate(${rotate} ${size / 2} ${size / 2}) scale(${size / 64})" opacity="${opacity}">${logoMarkInner(logo)}</g>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">${mark(14, 18, 44, -12, 0.22)}${mark(104, 70, 38, 14, 0.18)}${mark(40, 116, 32, 8, 0.16)}</svg>`
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`
}

/** data-wallpaper attribute + inline variables for the chat column. */
export function useWallpaper(conversationId: string): { attr?: string; style?: CSSProperties } {
  const value = useStore((s) => s.settings.contactOverrides?.[conversationId]?.wallpaper)
  const logo = useStore((s) => s.settings.logo ?? 'buddies')
  return useMemo(() => {
    if (!value) return {}
    if (value.startsWith('data:image/')) return { attr: 'photo', style: { '--wallpaper-photo': `url("${value}")` } as CSSProperties }
    if (!isWallpaperPreset(value)) return {}
    if (value === 'buddies') return { attr: value, style: { '--wallpaper-pattern': buddiesPattern(logo), '--wallpaper-tint': LOGOS[logo].background } as CSSProperties }
    return { attr: value }
  }, [value, logo])
}

/** Shrink an uploaded photo so it stays light in settings (longest side 1600 px, JPEG). */
async function toWallpaperDataUrl(file: File, max = 1600): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('Not an image'))
      i.src = url
    })
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.82)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Info panel row: pick a chat wallpaper for this person (applies right away, like the bubble colour). */
export function WallpaperRow({ conversationId }: { conversationId: string }): JSX.Element {
  const t = useT()
  const language = useStore((s) => s.settings.language)
  const logo = useStore((s) => s.settings.logo ?? 'buddies')
  const custom = useStore((s) => s.settings.contactOverrides?.[conversationId])
  const setContactOverride = useStore((s) => s.setContactOverride)
  const showToast = useStore((s) => s.showToast)
  const input = useRef<HTMLInputElement>(null)
  const current = custom?.wallpaper
  const pick = (wallpaper?: string): void => void setContactOverride(conversationId, { ...custom, wallpaper })
  const upload = async (file?: File): Promise<void> => {
    if (!file) return
    try {
      pick(await toWallpaperDataUrl(file))
    } catch (err) {
      showToast((err as Error).message, 'error')
    }
  }
  return (
    <div className="wallpaper-choices" role="radiogroup" aria-label={t('wallpaper')}>
      <button className={`wallpaper-choice none ${!current ? 'active' : ''}`} role="radio" aria-checked={!current} onClick={() => pick(undefined)} title={t('wallpaperNone')}>
        <span />
      </button>
      {WALLPAPERS.map((id) => (
        <button key={id} className={`wallpaper-choice ${current === id ? 'active' : ''}`} role="radio" aria-checked={current === id} onClick={() => pick(id)} title={NAMES[id][language]}>
          <span
            className="chat-wallpaper"
            data-wallpaper={id}
            style={id === 'buddies' ? ({ '--wallpaper-pattern': buddiesPattern(logo), '--wallpaper-tint': LOGOS[logo].background } as CSSProperties) : undefined}
          />
        </button>
      ))}
      {current?.startsWith('data:image/') && (
        <button className="wallpaper-choice active" role="radio" aria-checked title={t('wallpaperUpload')}>
          <span className="chat-wallpaper" data-wallpaper="photo" style={{ '--wallpaper-photo': `url("${current}")` } as CSSProperties} />
        </button>
      )}
      <button className="wallpaper-choice upload" onClick={() => input.current?.click()} title={t('wallpaperUpload')}>
        <ImagePlus size={16} strokeWidth={2.2} />
      </button>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => void upload(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
    </div>
  )
}
