import { useEffect } from 'react'
import { ExternalLink, X } from 'lucide-react'
import { useStore, useT, type Lightbox as LightboxState } from '../store'

export function Lightbox({ url, name, video, poster, externalUrl, externalLabel }: LightboxState): JSX.Element {
  const t = useT()
  const openLightbox = useStore((s) => s.openLightbox)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') openLightbox(undefined)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openLightbox])

  return (
    <div className="lightbox" onMouseDown={(e) => e.target === e.currentTarget && openLightbox(undefined)} role="dialog" aria-label={t('viewImage')}>
      {video ? (
        <video className="lightbox-media" src={url} poster={poster} controls autoPlay playsInline />
      ) : (
        <img className="lightbox-media" src={url} alt={name ?? ''} draggable={false} />
      )}
      <div className="lightbox-tools">
        {externalUrl && (
          <button className="lightbox-pill" onClick={() => void window.unison.app.openExternal(externalUrl)}>
            <ExternalLink size={14} strokeWidth={2.4} />
            {externalLabel ?? externalUrl}
          </button>
        )}
        <button className="lightbox-close" onClick={() => openLightbox(undefined)} title={t('close')}>
          <X size={18} strokeWidth={2.4} />
        </button>
      </div>
      {name && <div className="lightbox-caption">{name}</div>}
    </div>
  )
}
