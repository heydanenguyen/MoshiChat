import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, ExternalLink, X } from 'lucide-react'
import { useStore, useT, type Lightbox as LightboxState } from '../store'

export function Lightbox({ url, name, video, poster, externalUrl, externalLabel, gallery, index = 0 }: LightboxState): JSX.Element {
  const t = useT()
  const openLightbox = useStore((s) => s.openLightbox)
  const showToast = useStore((s) => s.showToast)
  const [saving, setSaving] = useState(false)
  const [current, setCurrent] = useState(index)
  const count = gallery?.length ?? 0
  const item = gallery?.[current] ?? { url, video, poster }
  const step = (delta: number): void => {
    if (count > 1) setCurrent((i) => (i + delta + count) % count)
  }

  useEffect(() => setCurrent(index), [index, url])

  const download = async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    try {
      const path = await window.unison.app.saveMedia(item.url, count > 1 ? undefined : name)
      if (path) showToast(t('mediaSaved', { name: path.split(/[\\/]/).pop() ?? '' }))
    } catch (err) {
      showToast(t('mediaSaveFailed', { reason: (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }), 'error')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') openLightbox(undefined)
      else if (e.key === 'ArrowRight') step(1)
      else if (e.key === 'ArrowLeft') step(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="lightbox" onMouseDown={(e) => e.target === e.currentTarget && openLightbox(undefined)} role="dialog" aria-label={t('viewImage')}>
      {item.video ? (
        <video key={item.url} className="lightbox-media" src={item.url} poster={item.poster} controls autoPlay playsInline />
      ) : (
        <img key={item.url} className="lightbox-media" src={item.url} alt={name ?? ''} draggable={false} />
      )}
      {count > 1 && (
        <>
          <button className="lightbox-nav prev" onClick={() => step(-1)} aria-label={t('previous')}>
            <ChevronLeft size={22} strokeWidth={2.4} />
          </button>
          <button className="lightbox-nav next" onClick={() => step(1)} aria-label={t('next')}>
            <ChevronRight size={22} strokeWidth={2.4} />
          </button>
          <div className="lightbox-count">
            {current + 1} / {count}
          </div>
        </>
      )}
      <div className="lightbox-tools">
        {externalUrl && (
          <button className="lightbox-pill" onClick={() => void window.unison.app.openExternal(externalUrl)}>
            <ExternalLink size={14} strokeWidth={2.4} />
            {externalLabel ?? externalUrl}
          </button>
        )}
        <button className="lightbox-close lightbox-download" onClick={() => void download()} disabled={saving} title={t('mediaDownload')} aria-label={t('mediaDownload')}>
          <Download size={18} strokeWidth={2.4} />
        </button>
        <button className="lightbox-close" onClick={() => openLightbox(undefined)} title={t('close')}>
          <X size={18} strokeWidth={2.4} />
        </button>
      </div>
      {name && <div className="lightbox-caption">{name}</div>}
    </div>
  )
}
