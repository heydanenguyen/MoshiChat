import { describe, expect, it } from 'vitest'
import { dueInfo, quickTimes } from '../src/shared/todos'

const at = (y: number, m: number, d: number, h: number, min = 0): number => new Date(y, m - 1, d, h, min).getTime()

describe('to-do due labels', () => {
  const now = at(2026, 9, 29, 10, 0)
  it('tells late, today, tomorrow and later apart', () => {
    expect(dueInfo(at(2026, 9, 29, 9, 30), now)).toEqual({ tone: 'late', lateMinutes: 30, lateDays: 0 })
    expect(dueInfo(at(2026, 9, 27, 14, 0), now)).toMatchObject({ tone: 'late', lateDays: 2 })
    expect(dueInfo(at(2026, 9, 29, 18, 0), now).tone).toBe('today')
    expect(dueInfo(at(2026, 9, 30, 9, 0), now).tone).toBe('tomorrow')
    expect(dueInfo(at(2026, 10, 3, 9, 0), now).tone).toBe('later')
  })

  it('offers tonight only while it is still ahead', () => {
    expect(quickTimes(at(2026, 9, 29, 10, 0)).tonight).toBe(at(2026, 9, 29, 20, 0))
    expect(quickTimes(at(2026, 9, 29, 21, 0)).tonight).toBeUndefined()
    expect(quickTimes(at(2026, 9, 29, 21, 0)).tomorrow).toBe(at(2026, 9, 30, 9, 0))
  })
})
