import { X } from 'lucide-react'
import { useStore, useT } from '../store'

export function Lightbox({ url, name }: { url: string; name?: string }): JSX.Element {
  const t = useT()
  const openLightbox = useStore((s) => s.openLightbox)
  return (
    <div className="lightbox" onMouseDown={(e) => e.target === e.currentTarget && openLightbox(undefined)} role="dialog" aria-label={t('viewImage')}>
      <img src={url} alt={name ?? ''} draggable={false} />
      <button className="lightbox-close" onClick={() => openLightbox(undefined)} title={t('close')}>
        <X size={18} strokeWidth={2.4} />
      </button>
      {name && <div className="lightbox-caption">{name}</div>}
    </div>
  )
}
