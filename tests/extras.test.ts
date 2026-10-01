import { describe, expect, it } from 'vitest'
import { daysUntilBirthday, defaultQuickReplies, detectEffect, fillQuickReply, givenName, isBirthdayToday, isWallpaperPreset, parseBirthday, turningAge } from '../src/shared/extras'

describe('message effects', () => {
  it('recognises wishes in Vietnamese (with or without accents) and English', () => {
    expect(detectEffect('Chúc mừng sinh nhật em nha!!')).toBe('birthday')
    expect(detectEffect('chuc mung sinh nhat')).toBe('birthday')
    expect(detectEffect('HPBD bro')).toBe('birthday')
    expect(detectEffect('Happy birthday Linh 🎂')).toBe('birthday')
    expect(detectEffect('Chúc mừng năm mới, an khang thịnh vượng')).toBe('newyear')
    expect(detectEffect('Happy New Year!')).toBe('newyear')
    expect(detectEffect('Chúc mừng bạn đậu đại học')).toBe('congrats')
    expect(detectEffect('congrats on the job')).toBe('congrats')
    expect(detectEffect('yêu em nhiều')).toBe('love')
    expect(detectEffect('love you ❤️')).toBe('love')
    expect(detectEffect('❤️❤️')).toBe('love')
  })

  it('stays quiet for ordinary messages', () => {
    for (const text of ['ok', 'mai gặp nhé', 'birthday party ở đâu?', 'I love pizza', 'chúc ngủ ngon', '', 'yêu cầu gửi file']) {
      expect(detectEffect(text)).toBeUndefined()
    }
  })
})

describe('birthdays and names', () => {
  const day = new Date(2026, 8, 27)
  it('matches full and yearless birthdays on the day only', () => {
    expect(isBirthdayToday('1998-09-27', day)).toBe(true)
    expect(isBirthdayToday('--09-27', day)).toBe(true)
    expect(isBirthdayToday('1998-09-28', day)).toBe(false)
    expect(isBirthdayToday(undefined, day)).toBe(false)
    expect(isBirthdayToday('27/09', day)).toBe(false)
  })

  it('picks the given name the Vietnamese or western way', () => {
    expect(givenName('Nguyễn Thùy Linh')).toBe('Linh')
    expect(givenName('Alex Kim')).toBe('Alex')
    expect(givenName('Mai')).toBe('Mai')
    expect(givenName('Mai Anh (work)')).toBe('Mai')
    expect(givenName('🌸 Nguyễn Thùy Linh 🌸')).toBe('Linh')
  })
})

describe('quick replies', () => {
  it('ships a starter set per language and fills {name}', () => {
    expect(defaultQuickReplies('vi').length).toBeGreaterThanOrEqual(4)
    expect(defaultQuickReplies('en')[0].text).toContain('{name}')
    expect(fillQuickReply('Thanks, {name}! See you {name}', 'Linh')).toBe('Thanks, Linh! See you Linh')
  })

  it('knows the wallpaper presets', () => {
    expect(isWallpaperPreset('hearts')).toBe(true)
    expect(isWallpaperPreset('data:image/png;base64,xx')).toBe(false)
  })
})

describe('birthdays ahead', () => {
  const now = new Date(2026, 9, 1, 15)
  it('counts days to the next one, with or without the year', () => {
    expect(daysUntilBirthday('1998-10-01', now)).toBe(0)
    expect(daysUntilBirthday('--10-02', now)).toBe(1)
    expect(daysUntilBirthday('1990-09-30', now)).toBe(364)
    expect(daysUntilBirthday('nonsense', now)).toBeUndefined()
    expect(parseBirthday('--07-04')).toEqual({ month: 7, day: 4, year: undefined })
  })
  it('says the age they turn only when the year is known', () => {
    expect(turningAge('1998-10-02', now)).toBe(28)
    expect(turningAge('1990-09-30', now)).toBe(37)
    expect(turningAge('--10-02', now)).toBeUndefined()
  })
})
