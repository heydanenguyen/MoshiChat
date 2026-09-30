import { describe, expect, it } from 'vitest'
import { firstNameOf, greetingFor, pickSplashLine, splashLines } from '../src/renderer/src/greetings'
import { formatMomentDate, formatMonthLabel } from '../src/renderer/src/utils'

describe('launch greetings', () => {
  it('has several clean lines for every hour in both languages', () => {
    for (const language of ['vi', 'en'] as const) {
      for (const name of ['', 'Linh']) {
        for (let hour = 0; hour < 24; hour++) {
          const lines = splashLines(language, name, hour)
          expect(lines.length).toBeGreaterThanOrEqual(10)
          for (const line of lines) {
            expect(line.emoji).toBeTruthy()
            expect(line.text).not.toMatch(/undefined|\$\{|, ,|\s{2}/)
          }
        }
      }
    }
  })

  it('greets by first name and never repeats the last line', () => {
    const lines = splashLines('vi', 'Linh', 9)
    expect(lines.some((l) => l.text.includes('Linh'))).toBe(true)
    for (let i = 0; i < 50; i++) {
      const avoid = lines[i % lines.length].text
      expect(pickSplashLine('vi', 'Linh', 9, avoid).text).not.toBe(avoid)
    }
    // time of day lines come first
    expect(splashLines('en', '', 8)[0].text).toContain('morning')
    expect(splashLines('en', '', 20)[0].text).toContain('evening')
  })

  it('picks the given name the way the title bar does', () => {
    expect(firstNameOf([{ displayName: 'Nguyễn Thùy Linh' }])).toBe('Linh')
    expect(firstNameOf([{ displayName: 'Demo', demo: true }, { displayName: 'Alex Kim' }])).toBe('Alex')
    expect(firstNameOf([])).toBe('')
  })

  it('does not celebrate inbox zero before any account is connected', () => {
    const texts = (hasAccounts: boolean): string[] =>
      Array.from({ length: 60 }, (_, tick) => greetingFor({ language: 'en', name: '', unread: 0, hasAccounts, tick }).text)
    expect(texts(false).some((text) => text.includes('Inbox zero'))).toBe(false)
    expect(texts(false).some((text) => text.includes('Connect an account'))).toBe(true)
    expect(texts(true).some((text) => text.includes('Inbox zero'))).toBe(true)
  })
})

describe('moment dates', () => {
  it('labels months and days', () => {
    const ts = new Date(2024, 8, 27, 21, 40).getTime()
    expect(formatMonthLabel(ts, 'vi')).toBe('Tháng 9, 2024')
    expect(formatMonthLabel(ts, 'en')).toBe('September 2024')
    expect(formatMomentDate(ts, 'en')).toContain('2024')
    expect(formatMomentDate(ts, 'en', true)).not.toContain(':')
    const thisYear = new Date(new Date().getFullYear(), 0, 2, 9, 5).getTime()
    expect(formatMomentDate(thisYear, 'en')).not.toContain(String(new Date().getFullYear()))
  })
})
