import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PREFIX = ":root:not([data-style='liquid'], [data-style='mono'], [data-style='pals'])"
/** Inert base rules (hidden spans / a display:contents wrapper) that exist for every style on purpose. */
const BASE = new Set(['.call-card-avatar', '.call-ring', '.call-card-glyph'])

const css = readFileSync('src/renderer/src/styles/app.css', 'utf8')
const start = css.indexOf('Quiet Glass (UI direction A, phases 0-1)')
const section = css.slice(css.lastIndexOf('/*', start)).replace(/\/\*[\s\S]*?\*\//g, '')

/** Selector lists of every style rule in `text`, looking inside @media / @container (not @keyframes). */
function selectors(text: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < text.length) {
    const open = text.indexOf('{', i)
    if (open < 0) break
    let depth = 1
    let end = open + 1
    while (depth && end < text.length) depth += text[end] === '{' ? 1 : text[end] === '}' ? -1 : 0, end++
    const head = text.slice(i, open).trim()
    if (/^@(media|container|supports)/.test(head)) out.push(...selectors(text.slice(open + 1, end - 1)))
    else if (!head.startsWith('@')) out.push(...head.split(/,(?![^(]*\))/).map((s) => s.trim()))
    i = end
  }
  return out
}

describe('Quiet Glass stays inside the default style', () => {
  const list = selectors(section)
  it('finds the section', () => expect(list.length).toBeGreaterThan(100))
  it('starts every selector with the style test (or is a listed inert base rule)', () => {
    const bad = list.filter((s) => !s.startsWith(PREFIX) && !BASE.has(s))
    expect(bad).toEqual([])
  })
})
