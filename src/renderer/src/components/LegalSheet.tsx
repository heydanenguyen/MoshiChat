import { useEffect, useState, type ReactNode } from 'react'
import { ChevronLeft, X } from 'lucide-react'
import { useStore, useT, type LegalDoc } from '../store'
import { BuddyLoader } from './BuddyLoader'

export const LEGAL_TITLE_KEY = { notice: 'legalNotice', license: 'legalLicense', terms: 'legalTerms', privacy: 'legalPrivacy', credits: 'legalCredits' } as const

/** Bold, italics, code and links inside one line of the legal documents. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|<?https?:\/\/[^\s)|>]+>?)/).map((part, i) => {
    if (part.startsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*')) return <em key={i}>{part.slice(1, -1)}</em>
    if (part.startsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>
    if (/^<?https?:\/\//.test(part)) {
      const url = part.replace(/^<|>$/g, '')
      return (
        <a
          key={i}
          href={url}
          onClick={(e) => {
            e.preventDefault()
            void window.unison.app.openExternal(url)
          }}
        >
          {url.replace(/^https?:\/\//, '')}
        </a>
      )
    }
    return part
  })
}

/** The small Markdown subset the bundled legal documents use: headings, lists, tables, rules, paragraphs. */
function render(markdown: string): ReactNode[] {
  const out: ReactNode[] = []
  const lines = markdown.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    if (line.startsWith('# ')) out.push(<h2 key={i}>{inline(line.slice(2))}</h2>)
    else if (line.startsWith('## ')) out.push(<h3 key={i}>{inline(line.slice(3))}</h3>)
    else if (line.startsWith('---')) out.push(<hr key={i} />)
    else if (line.startsWith('- ')) {
      const items: string[] = []
      while (i < lines.length && lines[i].startsWith('- ')) items.push(lines[i++].slice(2))
      i--
      out.push(
        <ul key={i}>
          {items.map((item, j) => (
            <li key={j}>{inline(item)}</li>
          ))}
        </ul>
      )
    } else if (line.startsWith('|')) {
      const rows: string[][] = []
      while (i < lines.length && lines[i].startsWith('|')) {
        const cells = lines[i].slice(1, -1).split('|').map((c) => c.trim())
        if (!cells.every((c) => /^-+$/.test(c))) rows.push(cells)
        i++
      }
      i--
      const [head, ...body] = rows
      out.push(
        <table key={i}>
          <thead>
            <tr>
              {head.map((c, j) => (
                <th key={j}>{inline(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((r, j) => (
              <tr key={j}>
                {r.map((c, k) => (
                  <td key={k}>{inline(c)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
    } else if (/^\*[^*].*\*$/.test(line)) out.push(<p key={i}><em>{inline(line.slice(1, -1))}</em></p>)
    else out.push(<p key={i}>{inline(line)}</p>)
  }
  return out
}

/** One of the bundled legal documents (Vietnamese first, English below), loaded from the app's resources. */
export function LegalText({ doc }: { doc: LegalDoc }): JSX.Element {
  const [text, setText] = useState<string | undefined>()
  useEffect(() => {
    let live = true
    setText(undefined)
    void window.unison.app
      .legal(doc)
      .then((value) => live && setText(value))
      .catch(() => live && setText(''))
    return () => {
      live = false
    }
  }, [doc])
  if (text === undefined) return <BuddyLoader size={26} className="details-loader" />
  // The GPL is plain text laid out by hand; show it as is.
  if (doc === 'license') return <pre className="legal-pre">{text}</pre>
  return <div className="legal-text">{render(text)}</div>
}

/** Settings → Legal: a full-height reader for the terms, the privacy policy and third-party notices. */
export function LegalSheet({ doc }: { doc: LegalDoc }): JSX.Element {
  const t = useT()
  const closeSheet = useStore((s) => s.closeSheet)
  const openSheet = useStore((s) => s.openSheet)
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeSheet()}>
      <div className="sheet" role="dialog" aria-label={t(LEGAL_TITLE_KEY[doc])}>
        <div className="sheet-header">
          <button className="icon-btn" onClick={() => openSheet({ kind: 'settings' })} title={t('back')}>
            <ChevronLeft size={18} strokeWidth={2.4} />
          </button>
          <div className="sheet-title">{t(LEGAL_TITLE_KEY[doc])}</div>
          <button className="icon-btn" onClick={closeSheet} title={t('close')}>
            <X size={16} strokeWidth={2.4} />
          </button>
        </div>
        <div className="sheet-body scroll">
          <LegalText doc={doc} />
        </div>
      </div>
    </div>
  )
}
