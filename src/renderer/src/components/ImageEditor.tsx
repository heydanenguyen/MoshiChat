import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Check, Circle, Copy, Crop, Download, Grid3x3, Highlighter, MousePointer2, Pencil, Redo2, RotateCcw, Send, Square, Type, Undo2, X } from 'lucide-react'
import { useStore, useT } from '../store'
import type { TKey } from '../i18n'
import {
  COLORS,
  FONT,
  bbox,
  clampRect,
  constrain,
  fontSize,
  hitTest,
  isEmpty,
  nextNumber,
  normRect,
  paint,
  translate,
  unitFor,
  type Doc,
  type Pt,
  type Rect,
  type Shape,
  type Size,
  type Tool
} from '../editor/shapes'

type History = { past: Doc[]; doc: Doc; future: Doc[] }
type TextEdit = { at: Pt; value: string; id?: number; color: string; size: Size }
type Drag =
  | { mode: 'draw' }
  | { mode: 'move'; start: Pt; origin: Doc; id: number; moved: boolean }
  | { mode: 'crop-new'; start: Pt }
  | { mode: 'crop-move'; start: Pt; from: Rect }
  | { mode: 'crop-handle'; handle: 'nw' | 'ne' | 'sw' | 'se'; from: Rect }

const TOOLS: Array<{ id: Tool; key: string; label: TKey; icon: JSX.Element }> = [
  { id: 'select', key: 'v', label: 'editorToolSelect', icon: <MousePointer2 size={17} strokeWidth={2.2} /> },
  { id: 'arrow', key: 'a', label: 'editorToolArrow', icon: <ArrowUpRight size={18} strokeWidth={2.4} /> },
  { id: 'rect', key: 'r', label: 'editorToolRect', icon: <Square size={16} strokeWidth={2.4} /> },
  { id: 'ellipse', key: 'o', label: 'editorToolEllipse', icon: <Circle size={17} strokeWidth={2.4} /> },
  { id: 'pen', key: 'p', label: 'editorToolPen', icon: <Pencil size={16} strokeWidth={2.3} /> },
  { id: 'highlight', key: 'h', label: 'editorToolHighlight', icon: <Highlighter size={17} strokeWidth={2.2} /> },
  { id: 'text', key: 't', label: 'editorToolText', icon: <Type size={17} strokeWidth={2.4} /> },
  { id: 'number', key: 'n', label: 'editorToolNumber', icon: <span className="ie-number-icon">1</span> },
  { id: 'blur', key: 'b', label: 'editorToolBlur', icon: <Grid3x3 size={17} strokeWidth={2.2} /> },
  { id: 'crop', key: 'c', label: 'editorToolCrop', icon: <Crop size={17} strokeWidth={2.2} /> }
]
const DRAW_TOOLS = new Set<Tool>(['arrow', 'rect', 'ellipse', 'pen', 'highlight', 'blur'])

const PREFS_KEY = 'moshi.editor'
function readPrefs(): { tool: Tool; color: string; size: Size } {
  const fallback = { tool: 'arrow' as Tool, color: COLORS[0] as string, size: 1 as Size }
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<typeof fallback>
    return {
      tool: TOOLS.some((x) => x.id === saved.tool) && saved.tool !== 'crop' ? saved.tool! : fallback.tool,
      color: COLORS.includes(saved.color as (typeof COLORS)[number]) ? saved.color! : fallback.color,
      size: saved.size === 0 || saved.size === 1 || saved.size === 2 ? saved.size : fallback.size
    }
  } catch {
    return fallback
  }
}

let measureCtx: CanvasRenderingContext2D | null = null
const measure = (text: string, px: number): number => {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  if (!measureCtx) return text.length * px * 0.6
  measureCtx.font = FONT(px)
  return measureCtx.measureText(text).width
}

const isMac = navigator.platform.toLowerCase().includes('mac')
const MOD = isMac ? '⌘' : 'Ctrl+'

/**
 * Quick markup for a photo from a chat: arrows, boxes, highlighter, text, numbered steps, pixelate and
 * crop, with undo, then copy, save or drop the result into the chat's composer. Opened from the viewer.
 */
export function ImageEditor({ src, name, conversationId, onClose, onDone }: { src: string; name?: string; conversationId?: string; onClose(): void; onDone(): void }): JSX.Element {
  const t = useT()
  const showToast = useStore((s) => s.showToast)
  const addFiles = useStore((s) => s.addFiles)
  const [image, setImage] = useState<HTMLImageElement>()
  const [sourceMime, setSourceMime] = useState('image/png')
  const [failed, setFailed] = useState<string>()
  const [hist, setHist] = useState<History>({ past: [], doc: { shapes: [] }, future: [] })
  const doc = hist.doc
  const prefs = useMemo(readPrefs, [])
  const [tool, setToolRaw] = useState<Tool>(prefs.tool)
  const [color, setColorRaw] = useState(prefs.color)
  const [size, setSizeRaw] = useState<Size>(prefs.size)
  // Pointer handlers read these refs, so a tool picked a moment before pressing is always the one used.
  const toolRef = useRef(tool)
  const colorRef = useRef(color)
  const sizeRef = useRef(size)
  const setToolState = (next: Tool): void => {
    toolRef.current = next
    setToolRaw(next)
  }
  const setColor = (next: string): void => {
    colorRef.current = next
    setColorRaw(next)
  }
  const setSize = (next: Size): void => {
    sizeRef.current = next
    setSizeRaw(next)
  }
  const [draft, setDraftState] = useState<Shape>()
  const draftRef = useRef<Shape>()
  const setDraft = (next: Shape | undefined): void => {
    draftRef.current = next
    setDraftState(next)
  }
  const [selected, setSelected] = useState<number>()
  const [textEdit, setTextEditState] = useState<TextEdit>()
  const editRef = useRef<TextEdit>()
  const setTextEdit = useCallback((next: TextEdit | undefined) => {
    editRef.current = next
    setTextEditState(next)
  }, [])
  const [cropDraft, setCropDraft] = useState<Rect>()
  const [busy, setBusy] = useState<'copy' | 'save' | 'send'>()
  const [confirmClose, setConfirmClose] = useState(false)
  const [stage, setStage] = useState({ w: 0, h: 0 })
  const [hover, setHover] = useState<'shape' | 'crop-move' | 'nwse' | 'nesw'>()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const drag = useRef<Drag>()
  const lastTool = useRef<Tool>(prefs.tool === 'select' ? 'arrow' : prefs.tool)
  const idSeq = useRef(1)
  const shift = useRef(false)

  // ---- load the photo as bytes (a remote <img> would taint the canvas and block the export)
  useEffect(() => {
    let live = true
    setFailed(undefined)
    const load = async (): Promise<void> => {
      const data = src.startsWith('data:') || src.startsWith('blob:') ? src : await window.unison.app.mediaData(src)
      const mime = /^data:([^;,]+)/.exec(data)?.[1] ?? 'image/png'
      const img = new Image()
      img.decoding = 'async'
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error(t('editorLoadFailed')))
        img.src = data
      })
      if (!live) return
      setSourceMime(mime)
      setImage(img)
    }
    load().catch((err: Error) => live && setFailed(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
    return () => {
      live = false
    }
  }, [src, t])

  // Dev-only handle for the UI checks (npm run dev with MOSHI_UI_SCRIPT).
  if (import.meta.env.DEV) (window as unknown as { __moshiEditor?: unknown }).__moshiEditor = { doc, tool, selected, draft: draftRef.current, past: hist.past.length }

  const full: Rect = useMemo(() => ({ x: 0, y: 0, w: image?.naturalWidth ?? 1, h: image?.naturalHeight ?? 1 }), [image])
  const unit = unitFor(full.w, full.h)
  const view: Rect = tool === 'crop' ? full : (doc.crop ?? full)

  // ---- fit the canvas into the stage
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const update = (): void => setStage({ w: el.clientWidth, h: el.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const scale = stage.w && stage.h ? Math.min((stage.w - 48) / view.w, (stage.h - 48) / view.h, 2) : 1
  const cssW = Math.max(1, Math.round(view.w * scale))
  const cssH = Math.max(1, Math.round(view.h * scale))

  // ---- history
  const commit = useCallback((next: Doc) => setHist((h) => ({ past: [...h.past, h.doc].slice(-150), doc: next, future: [] })), [])
  const undo = useCallback(() => {
    setHist((h) => (h.past.length ? { past: h.past.slice(0, -1), doc: h.past[h.past.length - 1], future: [h.doc, ...h.future] } : h))
    setSelected(undefined)
  }, [])
  const redo = useCallback(() => {
    setHist((h) => (h.future.length ? { past: [...h.past, h.doc], doc: h.future[0], future: h.future.slice(1) } : h))
    setSelected(undefined)
  }, [])
  const dirty = hist.past.length > 0

  const savePrefs = (next: Partial<{ tool: Tool; color: string; size: Size }>): void => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ tool, color, size, ...next }))
    } catch {
      /* private mode */
    }
  }

  // ---- text
  const commitText = useCallback(() => {
    const edit = editRef.current
    if (!edit) return
    setTextEdit(undefined)
    const text = edit.value.replace(/\s+$/, '')
    const newId = edit.id === undefined && text ? idSeq.current++ : undefined
    setHist((h) => {
      const shapes = h.doc.shapes
      let next: Shape[]
      if (edit.id !== undefined) {
        const before = shapes.find((x) => x.id === edit.id)
        if (before && before.kind === 'text' && before.text === text && before.color === edit.color && before.size === edit.size) return h
        next = text ? shapes.map((x) => (x.id === edit.id && x.kind === 'text' ? { ...x, text, color: edit.color, size: edit.size } : x)) : shapes.filter((x) => x.id !== edit.id)
      } else {
        if (newId === undefined) return h
        next = [...shapes, { id: newId, kind: 'text', at: edit.at, text, color: edit.color, size: edit.size }]
      }
      return { past: [...h.past, h.doc].slice(-150), doc: { ...h.doc, shapes: next }, future: [] }
    })
  }, [setTextEdit])

  const setTool = useCallback(
    (next: Tool) => {
      if (textEdit) commitText()
      setSelected(undefined)
      setDraft(undefined)
      if (next === 'crop') setCropDraft(doc.crop ?? full)
      else setCropDraft(undefined)
      if (next !== 'crop' && next !== 'select') lastTool.current = next
      setToolState(next)
      if (next !== 'crop') savePrefs({ tool: next })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [textEdit, commitText, doc.crop, full, color, size]
  )

  const applyCrop = useCallback(() => {
    const r = cropDraft ? clampRect(cropDraft, full.w, full.h) : undefined
    const whole = !r || (r.x <= 0.5 && r.y <= 0.5 && r.w >= full.w - 1 && r.h >= full.h - 1)
    const next = whole ? undefined : { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(8, Math.round(r.w)), h: Math.max(8, Math.round(r.h)) }
    if (JSON.stringify(next) !== JSON.stringify(doc.crop)) commit({ ...doc, crop: next })
    setCropDraft(undefined)
    setToolState(lastTool.current)
  }, [cropDraft, full, doc, commit])
  const cancelCrop = useCallback(() => {
    setCropDraft(undefined)
    setToolState(lastTool.current)
  }, [])

  // ---- paint
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !image) return
    const w = Math.max(1, Math.round(view.w))
    const h = Math.max(1, Math.round(view.h))
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const shapes = doc.shapes.filter((s) => s.id !== textEdit?.id)
    paint(ctx, image, draft ? [...shapes, draft] : shapes, view, unit)
    const px = 1 / scale
    ctx.save()
    ctx.translate(-view.x, -view.y)
    // selection
    const sel = selected !== undefined ? doc.shapes.find((s) => s.id === selected) : undefined
    if (sel && tool === 'select') {
      const r = bbox(sel, unit, measure)
      const pad = 5 * px
      ctx.setLineDash([5 * px, 4 * px])
      ctx.lineWidth = 1.5 * px
      ctx.strokeStyle = '#fff'
      ctx.strokeRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2)
      ctx.lineDashOffset = 4.5 * px
      ctx.strokeStyle = '#0A84FF'
      ctx.strokeRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2)
      ctx.setLineDash([])
    }
    // crop frame
    if (tool === 'crop' && cropDraft) {
      const r = normalize(cropDraft)
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.beginPath()
      ctx.rect(0, 0, full.w, full.h)
      ctx.rect(r.x, r.y, r.w, r.h)
      ctx.fill('evenodd')
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2 * px
      ctx.strokeRect(r.x, r.y, r.w, r.h)
      ctx.globalAlpha = 0.45
      ctx.lineWidth = 1 * px
      for (const f of [1 / 3, 2 / 3]) {
        ctx.beginPath()
        ctx.moveTo(r.x + r.w * f, r.y)
        ctx.lineTo(r.x + r.w * f, r.y + r.h)
        ctx.moveTo(r.x, r.y + r.h * f)
        ctx.lineTo(r.x + r.w, r.y + r.h * f)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      const len = Math.min(22 * px, r.w / 3, r.h / 3)
      ctx.lineWidth = 4 * px
      ctx.lineCap = 'round'
      for (const [cx, cy, sx, sy] of [
        [r.x, r.y, 1, 1],
        [r.x + r.w, r.y, -1, 1],
        [r.x, r.y + r.h, 1, -1],
        [r.x + r.w, r.y + r.h, -1, -1]
      ]) {
        ctx.beginPath()
        ctx.moveTo(cx + sx * len, cy)
        ctx.lineTo(cx, cy)
        ctx.lineTo(cx, cy + sy * len)
        ctx.stroke()
      }
    }
    ctx.restore()
  }, [image, doc, draft, view, unit, scale, selected, tool, cropDraft, textEdit?.id, full])

  // ---- pointer
  const toImage = (e: { clientX: number; clientY: number }): Pt => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: view.x + ((e.clientX - rect.left) / rect.width) * view.w, y: view.y + ((e.clientY - rect.top) / rect.height) * view.h }
  }
  const cropHandleAt = (p: Pt, r: Rect): 'nw' | 'ne' | 'sw' | 'se' | undefined => {
    const reach = 14 / scale
    const corners = { nw: [r.x, r.y], ne: [r.x + r.w, r.y], sw: [r.x, r.y + r.h], se: [r.x + r.w, r.y + r.h] } as const
    return (Object.keys(corners) as Array<keyof typeof corners>).find((k) => Math.hypot(p.x - corners[k][0], p.y - corners[k][1]) <= reach)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!image || e.button !== 0) return
    const tool = toolRef.current
    const color = colorRef.current
    const size = sizeRef.current
    shift.current = e.shiftKey
    // The first click after typing only finishes the text.
    if (editRef.current) {
      e.preventDefault()
      commitText()
      return
    }
    const p = toImage(e)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* not an active pointer (synthetic events) */
    }
    if (tool === 'crop') {
      const r = cropDraft ? normalize(cropDraft) : full
      const handle = cropHandleAt(p, r)
      const wholePhoto = r.x <= 0.5 && r.y <= 0.5 && r.w >= full.w - 1 && r.h >= full.h - 1
      if (handle) drag.current = { mode: 'crop-handle', handle, from: r }
      else if (!wholePhoto && p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h) drag.current = { mode: 'crop-move', start: p, from: r }
      else {
        drag.current = { mode: 'crop-new', start: p }
        setCropDraft({ x: p.x, y: p.y, w: 0, h: 0 })
      }
      return
    }
    if (tool === 'select') {
      const hit = hitTest(doc.shapes, p, unit, measure, 6 / scale)
      setSelected(hit?.id)
      if (hit) drag.current = { mode: 'move', start: p, origin: doc, id: hit.id, moved: false }
      return
    }
    if (tool === 'text') {
      const hit = hitTest(doc.shapes, p, unit, measure, 4 / scale)
      if (hit && hit.kind === 'text') setTextEdit({ at: hit.at, value: hit.text, id: hit.id, color: hit.color, size: hit.size })
      else setTextEdit({ at: { x: p.x, y: p.y - fontSize(unit, size) * 0.6 }, value: '', color, size })
      return
    }
    if (tool === 'number') {
      commit({ ...doc, shapes: [...doc.shapes, { id: idSeq.current++, kind: 'number', at: p, n: nextNumber(doc.shapes), color, size }] })
      return
    }
    if (!DRAW_TOOLS.has(tool)) return
    const id = idSeq.current++
    drag.current = { mode: 'draw' }
    if (tool === 'pen' || tool === 'highlight') setDraft({ id, kind: tool, points: [p], color, size })
    else setDraft({ id, kind: tool as 'arrow' | 'rect' | 'ellipse' | 'blur', a: p, b: p, color, size })
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!image) return
    shift.current = e.shiftKey
    const p = toImage(e)
    const d = drag.current
    if (!d) {
      // hover cursors
      if (tool === 'select') setHover(hitTest(doc.shapes, p, unit, measure, 6 / scale) ? 'shape' : undefined)
      else if (tool === 'crop' && cropDraft) {
        const r = normalize(cropDraft)
        const handle = cropHandleAt(p, r)
        const wholePhoto = r.x <= 0.5 && r.y <= 0.5 && r.w >= full.w - 1 && r.h >= full.h - 1
        setHover(handle ? (handle === 'nw' || handle === 'se' ? 'nwse' : 'nesw') : !wholePhoto && p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h ? 'crop-move' : undefined)
      } else setHover(undefined)
      return
    }
    if (d.mode === 'draw') {
      const s = draftRef.current
      if (!s) return
      if (s.kind === 'pen' || s.kind === 'highlight') {
        const first = s.points[0]
        if (e.shiftKey) setDraft({ ...s, points: [first, constrain(s.kind, first, p)] })
        else {
          const last = s.points[s.points.length - 1]
          if (Math.hypot(p.x - last.x, p.y - last.y) >= unit * 0.6) setDraft({ ...s, points: [...s.points, p] })
        }
      } else if (s.kind === 'arrow' || s.kind === 'rect' || s.kind === 'ellipse' || s.kind === 'blur') {
        setDraft({ ...s, b: e.shiftKey && s.kind !== 'blur' ? constrain(s.kind, s.a, p) : p })
      }
    } else if (d.mode === 'move') {
      const dx = p.x - d.start.x
      const dy = p.y - d.start.y
      if (!d.moved && Math.hypot(dx, dy) < 2 / scale) return
      d.moved = true
      setHist((h) => ({ ...h, doc: { ...d.origin, shapes: d.origin.shapes.map((s) => (s.id === d.id ? translate(s, dx, dy) : s)) } }))
    } else if (d.mode === 'crop-new') {
      const b = e.shiftKey ? constrain('rect', d.start, p) : p
      setCropDraft(clampRect(normRect(d.start, b), full.w, full.h))
    } else if (d.mode === 'crop-move') {
      const dx = Math.max(-d.from.x, Math.min(full.w - d.from.x - d.from.w, p.x - d.start.x))
      const dy = Math.max(-d.from.y, Math.min(full.h - d.from.y - d.from.h, p.y - d.start.y))
      setCropDraft({ ...d.from, x: d.from.x + dx, y: d.from.y + dy })
    } else if (d.mode === 'crop-handle') {
      const r = d.from
      const fixed = { nw: { x: r.x + r.w, y: r.y + r.h }, ne: { x: r.x, y: r.y + r.h }, sw: { x: r.x + r.w, y: r.y }, se: { x: r.x, y: r.y } }[d.handle]
      setCropDraft(clampRect(normRect(fixed, e.shiftKey ? constrain('rect', fixed, p) : p), full.w, full.h))
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const d = drag.current
    drag.current = undefined
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    if (!d) return
    if (d.mode === 'draw') {
      const s = draftRef.current
      setDraft(undefined)
      if (s && !isEmpty(s, unit)) commit({ ...doc, shapes: [...doc.shapes, s] })
    } else if (d.mode === 'move' && d.moved) {
      setHist((h) => ({ past: [...h.past, d.origin].slice(-150), doc: h.doc, future: [] }))
    } else if (d.mode === 'crop-new') {
      setCropDraft((r) => (r && (r.w < 8 || r.h < 8) ? (doc.crop ?? full) : r))
    }
  }

  // ---- export
  const exportImage = useCallback(
    async (forceMime?: string): Promise<{ bytes: Uint8Array; mime: string; blob: Blob }> => {
      if (!image) throw new Error(t('editorLoadFailed'))
      const r = doc.crop ?? full
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(r.w))
      canvas.height = Math.max(1, Math.round(r.h))
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas unavailable')
      const shapes = textEdit?.value.trim() ? [...doc.shapes.filter((s) => s.id !== textEdit.id), { id: -1, kind: 'text' as const, at: textEdit.at, text: textEdit.value, color: textEdit.color, size: textEdit.size }] : doc.shapes
      paint(ctx, image, shapes, r, unit)
      const mime = forceMime ?? (sourceMime === 'image/jpeg' ? 'image/jpeg' : 'image/png')
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, 0.92))
      if (!blob) throw new Error('Could not export the image')
      return { bytes: new Uint8Array(await blob.arrayBuffer()), mime, blob }
    },
    [image, doc, full, unit, sourceMime, textEdit, t]
  )
  const fileName = (mime: string): string => {
    const stem = (name && !/^https?:|^data:/.test(name) ? name : 'photo').replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 80) || 'photo'
    return `${stem}-edited.${mime === 'image/jpeg' ? 'jpg' : 'png'}`
  }
  const clean = (err: unknown): string => String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

  const copy = useCallback(async () => {
    if (busy) return
    setBusy('copy')
    try {
      const { bytes } = await exportImage('image/png')
      await window.unison.app.copyImage(bytes)
      showToast(t('editorCopied'))
    } catch (err) {
      showToast(clean(err), 'error')
    } finally {
      setBusy(undefined)
    }
  }, [busy, exportImage, showToast, t])

  const save = useCallback(async () => {
    if (busy) return
    setBusy('save')
    try {
      const { blob, mime } = await exportImage()
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
      })
      const path = await window.unison.app.saveMedia(dataUrl, fileName(mime))
      if (path) {
        const parts = path.split(/[\\/]/)
        showToast(t('mediaSaved', { name: parts.pop() ?? '', folder: parts.pop() ?? '' }))
      }
    } catch (err) {
      showToast(t('mediaSaveFailed', { reason: clean(err) }), 'error')
    } finally {
      setBusy(undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, exportImage, showToast, t, name])

  const send = useCallback(async () => {
    if (busy) return
    const s = useStore.getState()
    const target = conversationId && s.conversations[conversationId] ? conversationId : (s.layout.panes[s.layout.active] ?? s.selectedId)
    const conversation = target ? s.conversations[target] : undefined
    if (!target || !conversation) {
      showToast(t('editorNoChat'), 'error')
      return
    }
    if (s.accounts[conversation.accountId]?.features.attachments === false) {
      showToast(t('editorNoAttach'), 'error')
      return
    }
    setBusy('send')
    try {
      const { bytes, mime } = await exportImage()
      const file = await window.unison.app.saveImage(bytes, mime, fileName(mime))
      addFiles(target, [file])
      if (!s.layout.panes.includes(target)) s.select(target)
      useStore.setState({ composerFocus: { conversationId: target, nonce: Date.now() } })
      onDone()
    } catch (err) {
      showToast(clean(err), 'error')
      setBusy(undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, conversationId, exportImage, addFiles, onDone, showToast, t, name])

  const requestClose = useCallback(() => {
    if (textEdit) commitText()
    if (dirty || textEdit?.value.trim()) setConfirmClose(true)
    else onClose()
  }, [dirty, textEdit, commitText, onClose])

  const removeSelected = useCallback(() => {
    if (selected === undefined) return
    commit({ ...doc, shapes: doc.shapes.filter((s) => s.id !== selected) })
    setSelected(undefined)
  }, [selected, doc, commit])

  // ---- keyboard: plain keys here, ⌘-shortcuts come from the main process (the menu would eat them)
  useEffect(() => {
    window.unison.app.setEditorKeys(!textEdit && !confirmClose)
    return () => window.unison.app.setEditorKeys(false)
  }, [textEdit, confirmClose])

  useEffect(
    () =>
      window.unison.onEvent((event) => {
        if (event.type !== 'editor:key' || confirmClose) return
        if (event.key === 'z') (event.shift ? redo : undo)()
        else if (event.key === 'y') redo()
        else if (event.key === 'c') void copy()
        else if (event.key === 's') void save()
        else if (event.key === 'enter') void send()
        else if (event.key === 'w') requestClose()
      }),
    [undo, redo, copy, save, send, requestClose, confirmClose]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (confirmClose) {
        if (e.key === 'Escape') setConfirmClose(false)
        return
      }
      const target = e.target as HTMLElement
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return
      const mod = isMac ? e.metaKey : e.ctrlKey
      // Windows/Linux reach here directly (no menu interception needed there).
      if (mod) {
        const key = e.key.toLowerCase()
        if (key === 'z') (e.shiftKey ? redo : undo)()
        else if (key === 'y') redo()
        else if (key === 'c') void copy()
        else if (key === 's') void save()
        else if (key === 'enter') void send()
        else return
        e.preventDefault()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        if (tool === 'crop') cancelCrop()
        else if (selected !== undefined) setSelected(undefined)
        else requestClose()
        return
      }
      if (e.key === 'Enter' && tool === 'crop') {
        e.preventDefault()
        applyCrop()
        return
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && selected !== undefined) {
        e.preventDefault()
        removeSelected()
        return
      }
      if (e.key.startsWith('Arrow') && selected !== undefined && tool === 'select') {
        e.preventDefault()
        const step = (e.shiftKey ? 10 : 1) / Math.min(1, scale)
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        commit({ ...doc, shapes: doc.shapes.map((s) => (s.id === selected ? translate(s, dx, dy) : s)) })
        return
      }
      if (e.altKey || e.ctrlKey || e.metaKey) return
      if (e.key === '1' || e.key === '2' || e.key === '3') {
        const next = (Number(e.key) - 1) as Size
        setSize(next)
        savePrefs({ size: next })
        return
      }
      const hit = TOOLS.find((x) => x.key === e.key.toLowerCase())
      if (hit) {
        e.preventDefault()
        setTool(hit.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmClose, tool, selected, doc, scale, undo, redo, copy, save, send, requestClose, cancelCrop, applyCrop, removeSelected, setTool, commit])

  // Changing colour or size restyles the selected mark (like every markup tool).
  const restyle = (patch: Partial<{ color: string; size: Size }>): void => {
    if (patch.color) setColor(patch.color)
    if (patch.size !== undefined) setSize(patch.size)
    savePrefs(patch)
    if (textEdit) setTextEdit({ ...textEdit, ...patch })
    if (selected !== undefined && tool === 'select') {
      const sel = doc.shapes.find((s) => s.id === selected)
      if (sel && sel.kind !== 'blur') commit({ ...doc, shapes: doc.shapes.map((s) => (s.id === selected ? { ...s, ...patch } : s)) })
    }
  }

  // focus the text box when it opens
  useEffect(() => {
    if (textEdit) requestAnimationFrame(() => textRef.current?.focus())
  }, [textEdit?.id, textEdit?.at.x, textEdit?.at.y]) // eslint-disable-line react-hooks/exhaustive-deps

  const cursor =
    tool === 'select'
      ? hover === 'shape'
        ? drag.current?.mode === 'move'
          ? 'grabbing'
          : 'move'
        : 'default'
      : tool === 'text'
        ? 'text'
        : tool === 'crop'
          ? hover === 'crop-move'
            ? 'move'
            : hover === 'nwse'
              ? 'nwse-resize'
              : hover === 'nesw'
                ? 'nesw-resize'
                : 'crosshair'
          : 'crosshair'

  const textStyle = ((): React.CSSProperties | undefined => {
    if (!textEdit || !canvasRef.current || !stageRef.current) return undefined
    const canvasBox = canvasRef.current.getBoundingClientRect()
    const stageBox = stageRef.current.getBoundingClientRect()
    const px = fontSize(unit, textEdit.size) * scale
    return {
      left: canvasBox.left - stageBox.left + (textEdit.at.x - view.x) * scale,
      top: canvasBox.top - stageBox.top + (textEdit.at.y - view.y) * scale,
      fontSize: px,
      color: textEdit.color,
      font: FONT(px),
      ['--ie-outline' as string]: textEdit.color === '#FFFFFF' || textEdit.color === '#FFD60A' ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.95)'
    }
  })()

  return (
    <div className="image-editor" role="dialog" aria-label={t('editorTitle')}>
      <header className="ie-top">
        <button className="ie-btn ghost" onClick={requestClose} title={`${t('cancel')} (Esc)`}>
          <X size={16} strokeWidth={2.4} />
          {t('cancel')}
        </button>
        <div className="ie-history">
          <button className="ie-icon" onClick={undo} disabled={!hist.past.length} title={`${t('editorUndo')} (${MOD}Z)`} aria-label={t('editorUndo')}>
            <Undo2 size={17} strokeWidth={2.3} />
          </button>
          <button className="ie-icon" onClick={redo} disabled={!hist.future.length} title={`${t('editorRedo')} (${isMac ? '⇧⌘Z' : 'Ctrl+Y'})`} aria-label={t('editorRedo')}>
            <Redo2 size={17} strokeWidth={2.3} />
          </button>
        </div>
        <div className="ie-actions">
          <button className="ie-btn" onClick={() => void copy()} disabled={!image || !!busy} title={`${t('editorCopy')} (${MOD}C)`}>
            <Copy size={15} strokeWidth={2.3} />
            <span className="ie-label">{t('editorCopy')}</span>
          </button>
          <button className="ie-btn" onClick={() => void save()} disabled={!image || !!busy} title={`${t('editorSave')} (${MOD}S)`}>
            <Download size={15} strokeWidth={2.3} />
            <span className="ie-label">{t('editorSave')}</span>
          </button>
          <button className="ie-btn primary" onClick={() => void send()} disabled={!image || !!busy} title={`${t('editorSendHint')} (${MOD}↵)`}>
            <Send size={15} strokeWidth={2.3} />
            {busy === 'send' ? t('editorSending') : t('editorSend')}
          </button>
        </div>
      </header>

      <div className="ie-stage" ref={stageRef}>
        {!image && !failed && <div className="ie-status">{t('editorLoading')}</div>}
        {failed && (
          <div className="ie-status error">
            {failed}
            <button className="ie-btn" onClick={onClose}>
              {t('close')}
            </button>
          </div>
        )}
        {image && (
          <canvas
            ref={canvasRef}
            className="ie-canvas"
            style={{ width: cssW, height: cssH, cursor }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => !drag.current && setHover(undefined)}
            onDoubleClick={(e) => {
              if (tool !== 'select') return
              const hit = hitTest(doc.shapes, toImage(e), unit, measure, 6 / scale)
              if (hit?.kind === 'text') setTextEdit({ at: hit.at, value: hit.text, id: hit.id, color: hit.color, size: hit.size })
            }}
          />
        )}
        {textEdit && textStyle && (
          <textarea
            ref={textRef}
            className="ie-text"
            style={textStyle}
            value={textEdit.value}
            placeholder={t('editorTextPlaceholder')}
            rows={1}
            spellCheck={false}
            onChange={(e) => setTextEdit({ ...textEdit, value: e.target.value })}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                setTextEdit(undefined)
              } else if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                commitText()
              }
            }}
          />
        )}
        {tool === 'crop' && cropDraft && image && (
          <div className="ie-crop-size">
            {Math.round(normalize(cropDraft).w)} × {Math.round(normalize(cropDraft).h)}
          </div>
        )}
      </div>

      <footer className="ie-bar" onMouseDown={(e) => e.preventDefault()}>
        {tool === 'crop' ? (
          <div className="ie-group">
            <span className="ie-hint">{t('editorCropHint')}</span>
            <button className="ie-btn" onClick={cancelCrop}>
              {t('cancel')}
            </button>
            <button className="ie-btn" onClick={() => setCropDraft(full)} title={t('editorCropReset')}>
              <RotateCcw size={15} strokeWidth={2.3} />
              {t('editorCropReset')}
            </button>
            <button className="ie-btn primary" onClick={applyCrop}>
              <Check size={15} strokeWidth={2.6} />
              {t('editorCropApply')}
            </button>
          </div>
        ) : (
          <>
            <div className="ie-group ie-tools" role="toolbar" aria-label={t('editorTitle')}>
              {TOOLS.map((x) => (
                <button key={x.id} className={`ie-tool ${tool === x.id ? 'active' : ''}`} onClick={() => setTool(x.id)} title={`${t(x.label)} (${x.key.toUpperCase()})`} aria-label={t(x.label)} aria-pressed={tool === x.id}>
                  {x.icon}
                </button>
              ))}
            </div>
            <span className="ie-divider" />
            <div className="ie-group ie-colors" role="radiogroup" aria-label={t('editorColor')}>
              {COLORS.map((c) => (
                <button key={c} className={`ie-swatch ${color === c ? 'active' : ''}`} style={{ ['--swatch' as string]: c }} onClick={() => restyle({ color: c })} aria-label={c} aria-checked={color === c} role="radio" />
              ))}
            </div>
            <span className="ie-divider" />
            <div className="ie-group ie-sizes" role="radiogroup" aria-label={t('editorSize')}>
              {([0, 1, 2] as Size[]).map((n) => (
                <button key={n} className={`ie-size ${size === n ? 'active' : ''}`} onClick={() => restyle({ size: n })} title={`${t('editorSize')} ${n + 1}`} aria-label={`${t('editorSize')} ${n + 1}`} aria-checked={size === n} role="radio">
                  <span style={{ width: 4 + n * 4, height: 4 + n * 4 }} />
                </button>
              ))}
            </div>
            {selected !== undefined && tool === 'select' && (
              <>
                <span className="ie-divider" />
                <button className="ie-btn danger" onClick={removeSelected} title={`${t('editorDelete')} (⌫)`}>
                  {t('editorDelete')}
                </button>
              </>
            )}
          </>
        )}
      </footer>

      {confirmClose && (
        <div className="ie-confirm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setConfirmClose(false)}>
          <div className="ie-confirm" role="alertdialog" aria-label={t('editorDiscardTitle')}>
            <strong>{t('editorDiscardTitle')}</strong>
            <p>{t('editorDiscardBody')}</p>
            <div className="ie-confirm-actions">
              <button className="ie-btn" onClick={() => setConfirmClose(false)} autoFocus>
                {t('editorKeepEditing')}
              </button>
              <button className="ie-btn danger-solid" onClick={onClose}>
                {t('editorDiscard')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function normalize(r: Rect): Rect {
  return { x: Math.min(r.x, r.x + r.w), y: Math.min(r.y, r.y + r.h), w: Math.abs(r.w), h: Math.abs(r.h) }
}
