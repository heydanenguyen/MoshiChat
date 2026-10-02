import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Pencil, Plus, Scissors, Send, Trash2 } from 'lucide-react'
import { AI_MODELS } from '@shared/ai'
import type { CustomSticker } from '@shared/bridge'
import { useStore, useT } from '../store'
import { useAi } from '../aiStore'
import { PictureArt } from './StickerPicker'

const USES_KEY = 'unison.stickerUses'
const CUTOUT_KEY = 'unison.stickerCutout'
/** A sticker made in the last day and not sent yet wears a small "new" dot. */
const FRESH_MS = 24 * 3600_000

function loadUses(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(USES_KEY) ?? '{}') as Record<string, number>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** Remember when a sticker was last sent (it moves to the front). */
function noteUse(id: string): Record<string, number> {
  const uses = { ...loadUses(), [id]: Date.now() }
  try {
    localStorage.setItem(USES_KEY, JSON.stringify(uses))
  } catch {
    /* private mode */
  }
  return uses
}

/** A small, steady tilt per sticker (from its id), as if each was stuck on by hand. */
function tiltOf(id: string): number {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0
  return ((Math.abs(h) % 7) - 3) * 0.9
}

type Menu = { id: string; x: number; y: number; mode: 'menu' | 'rename' | 'confirm' }

/**
 * "Mine" as a sticker album: the add tile comes first (with the cut-out switch on it), pictures can be dropped on the
 * panel or pasted, stickers sit slightly askew like stuck on paper and lift when pointed at, the ones you send move to
 * the front, and a right click offers send, rename, cut out the background and delete.
 */
export function MyStickers({ onPick }: { onPick(id: string): void }): JSX.Element {
  const t = useT()
  const mine = useStore((s) => s.customStickers)
  const making = useStore((s) => s.stickerMaker)
  const addSticker = useStore((s) => s.addSticker)
  const makeSticker = useStore((s) => s.makeSticker)
  const removeSticker = useStore((s) => s.removeSticker)
  const renameSticker = useStore((s) => s.renameSticker)
  const recutSticker = useStore((s) => s.recutSticker)
  const showToast = useStore((s) => s.showToast)
  const cutoutReady = useAi((s) => !!s.status?.cutout.ready)
  const [cutout, setCutout] = useState(() => {
    try {
      return localStorage.getItem(CUTOUT_KEY) !== 'off'
    } catch {
      return true
    }
  })
  const [uses, setUses] = useState(loadUses)
  const [dragging, setDragging] = useState(0)
  const [menu, setMenu] = useState<Menu | undefined>()
  const [draft, setDraft] = useState('')
  const album = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Just made or just sent first: what you are likely to want again.
  const ordered = useMemo(() => {
    const last = (s: CustomSticker): number => Math.max(s.createdAt, uses[s.id] ?? 0)
    return [...mine].sort((a, b) => last(b) - last(a))
  }, [mine, uses])

  const toggleCutout = (): void => {
    setCutout((on) => {
      try {
        localStorage.setItem(CUTOUT_KEY, on ? 'off' : 'on')
      } catch {
        /* private mode */
      }
      return !on
    })
  }

  const send = (s: CustomSticker): void => {
    setUses(noteUse(s.id))
    onPick(`custom:${s.id}`)
  }

  /** A dropped or pasted picture becomes a sticker (the first picture, if several came at once). */
  const fromFiles = useCallback(
    async (files: File[]): Promise<void> => {
      const file = files.find((f) => f.type.startsWith('image/'))
      if (!file) return showToast(t('albumNotPicture'), 'error')
      try {
        const path = window.unison.app.describeFile(file).path
        const source = path ? await window.unison.stickers.fromFile(path) : await window.unison.stickers.fromBytes(new Uint8Array(await file.arrayBuffer()), file.type)
        await makeSticker(source, cutout)
      } catch (err) {
        showToast((err as Error).message, 'error')
      }
    },
    [cutout, makeSticker, showToast, t]
  )

  // A picture pasted while "Mine" is open becomes a sticker, rather than an attachment for the composer.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
      if (!files.length) return
      e.preventDefault()
      e.stopPropagation()
      void fromFiles(files)
    }
    window.addEventListener('paste', onPaste, true)
    return () => window.removeEventListener('paste', onPaste, true)
  }, [fromFiles])

  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent): void => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(undefined)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // Escape closes the menu, not the whole picker.
      e.stopPropagation()
      setMenu(undefined)
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [menu])

  const isFiles = (e: React.DragEvent): boolean => e.dataTransfer.types.includes('Files')
  const dragHandlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (!isFiles(e)) return
      e.preventDefault()
      e.stopPropagation()
      setDragging((d) => d + 1)
    },
    onDragOver: (e: React.DragEvent) => {
      if (!isFiles(e)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'copy'
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!isFiles(e)) return
      e.stopPropagation()
      setDragging((d) => Math.max(0, d - 1))
    },
    onDrop: (e: React.DragEvent) => {
      if (!isFiles(e)) return
      e.preventDefault()
      e.stopPropagation()
      setDragging(0)
      void fromFiles([...e.dataTransfer.files])
    }
  }

  const openMenu = (e: React.MouseEvent, s: CustomSticker): void => {
    e.preventDefault()
    const box = album.current?.getBoundingClientRect()
    if (!box) return
    // Kept inside the panel: menus near the right or bottom edge open the other way.
    const x = Math.min(e.clientX - box.left, box.width - 196)
    const y = Math.min(e.clientY - box.top, box.height - 150)
    setMenu({ id: s.id, x: Math.max(6, x), y: Math.max(6, y), mode: 'menu' })
  }
  const target = menu ? mine.find((s) => s.id === menu.id) : undefined

  const cutoutChip = (
    <button
      className={`cutout-chip ${cutout ? 'on' : ''}`}
      onClick={toggleCutout}
      aria-pressed={cutout}
      title={`${t('stickerCutout')}${cutoutReady ? '' : ` · ${AI_MODELS.cutout.megabytes} MB`}`}
    >
      <Scissors size={11} strokeWidth={2.6} />
      {t('albumCutout')}
    </button>
  )

  return (
    <div className={`sticker-album ${dragging ? 'dropping' : ''}`} ref={album} {...dragHandlers}>
      {mine.length === 0 ? (
        <div className="album-empty">
          <span className="album-empty-mito">
            <PictureArt id="mito:chao" size={88} play="auto" />
          </span>
          <strong>{t('albumEmptyTitle')}</strong>
          <span className="album-empty-text">{t('albumEmptyText')}</span>
          <div className="album-empty-actions">
            <button className="btn primary small" onClick={() => void addSticker(cutout)}>
              <Plus size={14} strokeWidth={2.6} /> {t('albumPick')}
            </button>
            {cutoutChip}
          </div>
        </div>
      ) : (
        <div className="sticker-grid album-grid scroll">
          <div className="album-add">
            <button className="album-add-main" onClick={() => void addSticker(cutout)} title={t('albumAddHint')} aria-label={t('albumAddHint')}>
              <Plus size={22} strokeWidth={2.4} />
              <span>{t('albumAdd')}</span>
            </button>
            {cutoutChip}
          </div>
          {ordered.map((s) => (
            <button
              key={s.id}
              className={`sticker-cell mine album-cell ${making?.sticker?.id === s.id ? 'arriving' : ''} ${!uses[s.id] && Date.now() - s.createdAt < FRESH_MS ? 'fresh' : ''}`}
              data-sticker={s.id}
              style={{ '--tilt': `${tiltOf(s.id)}deg` } as CSSProperties}
              onClick={() => send(s)}
              onContextMenu={(e) => openMenu(e, s)}
              title={s.name}
              aria-label={s.name}
            >
              <img src={s.url} alt="" draggable={false} />
            </button>
          ))}
        </div>
      )}
      {dragging > 0 && (
        <div className="album-drop" aria-hidden>
          <span className="album-drop-badge">
            <Plus size={18} strokeWidth={2.6} />
          </span>
          {t('albumDrop')}
        </div>
      )}
      {menu && target && (
        <div className="album-menu" ref={menuRef} role="menu" style={{ left: menu.x, top: menu.y }}>
          <div className="album-menu-head">
            <img src={target.url} alt="" draggable={false} />
            <span>{target.name}</span>
          </div>
          {menu.mode === 'rename' ? (
            <form
              className="album-rename"
              onSubmit={(e) => {
                e.preventDefault()
                void renameSticker(target.id, draft)
                setMenu(undefined)
              }}
            >
              <input className="field-input" autoFocus value={draft} maxLength={40} onChange={(e) => setDraft(e.target.value)} placeholder={t('albumRename')} />
              <button className="btn primary small" type="submit" disabled={!draft.trim()}>
                {t('save')}
              </button>
            </form>
          ) : menu.mode === 'confirm' ? (
            <button
              role="menuitem"
              className="album-menu-item danger"
              onClick={() => {
                void removeSticker(target.id)
                setMenu(undefined)
              }}
            >
              <Trash2 size={14} strokeWidth={2.2} /> {t('albumDeleteSure')}
            </button>
          ) : (
            <>
              <button
                role="menuitem"
                className="album-menu-item"
                onClick={() => {
                  setMenu(undefined)
                  send(target)
                }}
              >
                <Send size={14} strokeWidth={2.2} /> {t('makerSend')}
              </button>
              <button
                role="menuitem"
                className="album-menu-item"
                onClick={() => {
                  setDraft(target.name)
                  setMenu({ ...menu, mode: 'rename' })
                }}
              >
                <Pencil size={14} strokeWidth={2.2} /> {t('albumRename')}
              </button>
              {!target.cut && !target.animated && (
                <button
                  role="menuitem"
                  className="album-menu-item"
                  onClick={() => {
                    setMenu(undefined)
                    void recutSticker(target.id)
                  }}
                >
                  <Scissors size={14} strokeWidth={2.2} /> {t('albumRecut')}
                </button>
              )}
              <button role="menuitem" className="album-menu-item danger" onClick={() => setMenu({ ...menu, mode: 'confirm' })}>
                <Trash2 size={14} strokeWidth={2.2} /> {t('stickerRemove')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
