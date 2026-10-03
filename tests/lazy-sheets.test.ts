import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * A component loaded with React.lazy must render inside a <Suspense>: the first time it opens it suspends, and with no
 * boundary React unmounts the whole app (the merge sheet once left a blank white window). Checked on the source.
 */
describe('lazy sheets', () => {
  const source = readFileSync(resolve('src/renderer/src/App.tsx'), 'utf8')
  const lazy = [...source.matchAll(/const (\w+) = lazy\(/g)].map((m) => m[1])
  const boundaries = [...source.matchAll(/<Suspense[\s\S]*?<\/Suspense>/g)].map((m) => [m.index!, m.index! + m[0].length])

  it('finds the lazy components', () => {
    expect(lazy.length).toBeGreaterThan(0)
  })

  it.each(lazy)('%s renders only inside a Suspense boundary', (name) => {
    const uses = [...source.matchAll(new RegExp(`<${name}[\\s/>]`, 'g'))].map((m) => m.index!)
    expect(uses.length).toBeGreaterThan(0)
    for (const at of uses) expect(boundaries.some(([from, to]) => at > from && at < to)).toBe(true)
  })
})
