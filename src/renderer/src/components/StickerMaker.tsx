import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useStore, useT } from '../store'
import { MitoArt } from './StickerPicker'
import { useAi } from '../aiStore'

const SCAN_LINES = ['makerScan1', 'makerScan2', 'makerScan3', 'makerScan4'] as const
const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * A photo becoming a sticker, over the "Mine" tab:
 * - cutting: the photo with a soft scan going up and down, twinkles, and Mito watching (lines change as it works);
 * - done: the background dissolves into specks, the sticker lifts off with a glow along its own edge and settles;
 *   "Done" flies it into its cell, "Send it" sends it, "Keep background" makes it again from the whole photo.
 */
export function StickerMaker({ onSend }: { onSend(id: string): void }): JSX.Element | null {
  const t = useT()
  const maker = useStore((s) => s.stickerMaker)
  const dismiss = useStore((s) => s.dismissStickerMaker)
  const remake = useStore((s) => s.remakeStickerWhole)
  const remakePrecise = useStore((s) => s.remakeStickerPrecise)
  // macOS lifted the subject: the bigger on-device model can be asked for a finer cut.
  const native = useAi((s) => !!s.status?.cutout.native)
  const [line, setLine] = useState(0)
  const [busy, setBusy] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const result = useRef<HTMLImageElement>(null)
  const phase = maker?.phase
  const startedAt = maker?.startedAt

  useEffect(() => {
    if (phase !== 'cutting') return
    setLine(0)
    const timer = setInterval(() => setLine((l) => Math.min(l + 1, SCAN_LINES.length - 1)), 2200)
    return () => clearInterval(timer)
  }, [phase, startedAt])

  // Specks the background breaks into: spread all round, a few bigger ones, accent and white.
  const specks = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => {
        const angle = (i / 22) * Math.PI * 2 + ((i * 37) % 10) / 20
        const reach = 70 + ((i * 53) % 60)
        return {
          '--x': `${Math.round(Math.cos(angle) * reach)}px`,
          '--y': `${Math.round(Math.sin(angle) * reach)}px`,
          '--s': `${3 + ((i * 7) % 5)}px`,
          '--d': `${(i % 6) * 30}ms`,
          '--c': i % 3 === 0 ? '#ffffff' : i % 3 === 1 ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 45%, #ffd36b)'
        } as CSSProperties
      }),
    // A fresh burst for every sticker made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [startedAt]
  )

  if (!maker) return null
  const sticker = maker.sticker

  /** "Done": the sticker flies into its cell in the grid underneath, which pops as it lands. */
  const finish = (): void => {
    const img = result.current
    const cell = sticker ? document.querySelector<HTMLElement>(`.sticker-cell.mine[data-sticker="${sticker.id}"]`) : null
    if (!img || !cell || reducedMotion()) return dismiss()
    setLeaving(true)
    const from = img.getBoundingClientRect()
    const to = cell.getBoundingClientRect()
    const dx = to.left + to.width / 2 - (from.left + from.width / 2)
    const dy = to.top + to.height / 2 - (from.top + from.height / 2)
    const scale = (to.width * 0.82) / Math.max(from.width, from.height)
    const flight = img.animate([{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${scale}) rotate(-6deg)` }], {
      duration: 520,
      easing: 'cubic-bezier(0.5, -0.25, 0.3, 1)',
      fill: 'forwards'
    })
    flight.onfinish = () => {
      dismiss()
      setLeaving(false)
      cell.classList.add('landed')
      window.setTimeout(() => cell.classList.remove('landed'), 600)
    }
  }

  const caption =
    maker.phase === 'cutting'
      ? t(SCAN_LINES[line])
      : maker.phase === 'error'
        ? t('makerError', { error: maker.error ?? '' })
        : t(maker.whole ? 'makerDoneWhole' : 'makerDone')

  return (
    <div className={`sticker-maker ${maker.phase} ${leaving ? 'leaving' : ''}`} role="status" aria-live="polite">
      <div className="maker-stage">
        {maker.preview && !maker.whole && (
          <span className="maker-photo">
            <img src={maker.preview} alt="" draggable={false} />
            {maker.phase === 'cutting' && <span className="maker-scan" aria-hidden />}
          </span>
        )}
        {maker.phase === 'cutting' && (
          <span className="maker-twinkles" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <i key={i} />
            ))}
          </span>
        )}
        {maker.phase === 'done' && sticker && (
          <>
            {!maker.whole && (
              <span className="maker-specks" aria-hidden>
                {specks.map((style, i) => (
                  <i key={i} style={style} />
                ))}
              </span>
            )}
            <img ref={result} key={sticker.id} className="maker-result" src={sticker.url} alt={t('sticker')} draggable={false} />
          </>
        )}
      </div>
      <div className="maker-foot">
        <span className="maker-mito">
          <MitoArt id={maker.phase === 'done' ? 'mito:quay' : 'mito:khohieu'} size={40} play="auto" />
        </span>
        <span className="maker-caption" key={caption}>
          {caption}
        </span>
      </div>
      {maker.phase === 'done' && sticker && (
        <div className="maker-actions">
          <button
            className="btn primary small"
            onClick={() => {
              onSend(`custom:${sticker.id}`)
              dismiss()
            }}
          >
            {t('makerSend')}
          </button>
          {!maker.whole && !maker.recut && (
            <button
              className="btn small"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await remake()
                setBusy(false)
              }}
            >
              {t('makerWhole')}
            </button>
          )}
          {native && !maker.whole && !maker.precise && (
            <button className="btn small" disabled={busy} title={t('makerPreciseHint')} onClick={() => void remakePrecise()}>
              {t('makerPrecise')}
            </button>
          )}
          <button className="btn small secondary" onClick={finish}>
            {t('makerKeep')}
          </button>
        </div>
      )}
      {maker.phase === 'error' && (
        <div className="maker-actions">
          <button className="btn small" onClick={dismiss}>
            {t('close')}
          </button>
        </div>
      )}
    </div>
  )
}
