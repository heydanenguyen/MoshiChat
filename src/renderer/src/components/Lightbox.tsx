import { lazy, Suspense, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, ExternalLink, PenLine, X } from 'lucide-react'
import { useStore, useT, type Lightbox as LightboxState } from '../store'
// The photo editor is big and opened rarely: it loads the first time someone edits a picture.
const ImageEditor = lazy(() => import('./ImageEditor').then((m) => ({ default: m.ImageEditor })))
import { mediaSrc, previewSrc } from '@shared/media'

export function Lightbox({ url, name, video, poster, externalUrl, externalLabel, gallery, index = 0, conversationId }: LightboxState): JSX.Element {
  const t = useT()
  const openLightbox = useStore((s) => s.openLightbox)
  const showToast = useStore((s) => s.showToast)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [current, setCurrent] = useState(index)
  const count = gallery?.length ?? 0
  const item = gallery?.[current] ?? { url, video, poster }
  const step = (delta: number): void => {
    if (count > 1) setCurrent((i) => (i + delta + count) % count)
  }

  useEffect(() => {
    setCurrent(index)
    setEditing(false)
  }, [index, url])

  const download = async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    try {
      const path = await window.unison.app.saveMedia(item.url, count > 1 ? undefined : name)
      if (path) {
        const parts = path.split(/[\\/]/)
        showToast(t('mediaSaved', { name: parts.pop() ?? '', folder: parts.pop() ?? '' }))
      }
    } catch (err) {
      showToast(t('mediaSaveFailed', { reason: (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }), 'error')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (editing) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') openLightbox(undefined)
      else if (e.key === 'ArrowRight') step(1)
      else if (e.key === 'ArrowLeft') step(-1)
      else if (e.key.toLowerCase() === 'e' && !item.video && !e.metaKey && !e.ctrlKey && !e.altKey) setEditing(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (editing && !item.video)
    return (
      <div className="lightbox editing">
        <Suspense fallback={null}>
          <ImageEditor src={item.url} name={count > 1 ? undefined : name} conversationId={conversationId} onClose={() => setEditing(false)} onDone={() => openLightbox(undefined)} />
        </Suspense>
      </div>
    )

  return (
    <div className="lightbox" onMouseDown={(e) => e.target === e.currentTarget && openLightbox(undefined)} role="dialog" aria-label={t('viewImage')}>
      {item.video ? (
        <video key={item.url} className="lightbox-media" src={mediaSrc(item.url)} poster={item.poster} controls autoPlay playsInline />
      ) : (
        // A screen-sized copy to look at (Download below still saves the original).
        <img
          key={item.url}
          className="lightbox-media"
          src={previewSrc(item.url, 2560)}
          alt={name ?? ''}
          draggable={false}
          onError={(e) => {
            if (e.currentTarget.src !== item.url) e.currentTarget.src = item.url
          }}
        />
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
        {!item.video && (
          <button className="lightbox-edit" onClick={() => setEditing(true)} title={`${t('editorOpen')} (E)`}>
            <PenLine size={16} strokeWidth={2.4} />
            {t('editorOpen')}
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
