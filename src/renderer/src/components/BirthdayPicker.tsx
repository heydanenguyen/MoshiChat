import { useEffect, useState } from 'react'
import { Cake, ChevronDown } from 'lucide-react'
import { daysUntilBirthday, parseBirthday, turningAge } from '@shared/extras'
import { useStore, useT } from '../store'

/** Days in a month; without a year, February has its 29th (a leap year stands in). */
const daysIn = (month: number, year?: number): number => new Date(year ?? 2000, month, 0).getDate()
const pad = (n: number): string => String(n).padStart(2, '0')
const yearValid = (y: string): boolean => /^\d{4}$/.test(y) && Number(y) >= 1900 && Number(y) <= new Date().getFullYear()

/**
 * A birthday as a line that opens into a small calendar: twelve months, then only the days that month has (so an
 * impossible date cannot be picked), and an optional year. Picking the day sets it and folds the calendar away.
 * The value is YYYY-MM-DD, or --MM-DD without a year.
 */
export function BirthdayPicker({ value, onChange }: { value?: string; onChange(value: string | undefined): void }): JSX.Element {
  const t = useT()
  const language = useStore((s) => s.settings.language)
  const stored = parseBirthday(value)
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState<number | undefined>(stored?.month)
  const [year, setYear] = useState(stored?.year ? String(stored.year) : '')
  // Follow the value when it changes from outside (undo, reset).
  useEffect(() => {
    const b = parseBirthday(value)
    setMonth(b?.month)
    setYear(b?.year ? String(b.year) : '')
  }, [value])
  const yearOk = !year || yearValid(year)
  const days = month ? daysIn(month, yearOk && year ? Number(year) : undefined) : 31

  const emit = (m: number | undefined, d: number | undefined, y: string): void => {
    if (!m || !d || (y && !yearValid(y)) || d > daysIn(m, y ? Number(y) : undefined)) return
    onChange(`${y || '-'}-${pad(m)}-${pad(d)}`)
  }

  const monthName = (m: number, style: 'short' | 'long'): string =>
    language === 'vi' && style === 'short' ? `T${m}` : new Intl.DateTimeFormat(language, { month: style }).format(new Date(2000, m - 1, 1))
  const summary = (() => {
    if (!stored) return undefined
    const date = new Intl.DateTimeFormat(language, { day: 'numeric', month: 'long' }).format(new Date(2000, stored.month - 1, stored.day))
    const until = daysUntilBirthday(value)
    const when = until === 0 ? t('birthdayIsToday') : until === 1 ? t('birthdayTomorrow') : until !== undefined ? t('birthdayIn', { n: String(until) }) : undefined
    const age = turningAge(value)
    return { date, note: [when, age ? t('turnsAge', { n: String(age) }) : undefined].filter(Boolean).join(', ') }
  })()

  return (
    <div className={`bday ${open ? 'open' : ''}`}>
      <button className="bday-line" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={t('birthdayHint')}>
        <span className="bday-icon" aria-hidden>
          <Cake size={15} strokeWidth={2.2} />
        </span>
        <span className="bday-text">
          <span className="bday-label">{t('birthday')}</span>
          {summary ? (
            <span className="bday-value">
              <strong>{summary.date}</strong>
              {summary.note && <span>{summary.note}</span>}
            </span>
          ) : (
            <span className="bday-value empty">{t('birthdayAdd')}</span>
          )}
        </span>
        <ChevronDown className="bday-chevron" size={16} strokeWidth={2.4} aria-hidden />
      </button>

      {open && (
        <div className="bday-panel">
          <div className="bday-months" role="radiogroup" aria-label={t('birthdayMonth')}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <button
                key={m}
                role="radio"
                aria-checked={month === m}
                aria-label={monthName(m, 'long')}
                className={month === m ? 'active' : ''}
                onClick={() => {
                  setMonth(m)
                  if (stored && month !== m) emit(m, stored.day, year)
                }}
              >
                {monthName(m, 'short')}
              </button>
            ))}
          </div>
          <div className={`bday-days ${month ? '' : 'waiting'}`} role="radiogroup" aria-label={t('birthdayDay')}>
            {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
              const picked = !!stored && stored.month === month && stored.day === d
              return (
                <button
                  key={d}
                  role="radio"
                  aria-checked={picked}
                  className={picked ? 'active' : ''}
                  disabled={!month}
                  onClick={() => {
                    emit(month, d, year)
                    setOpen(false)
                  }}
                >
                  {d}
                </button>
              )
            })}
          </div>
          <div className="bday-foot">
            <input
              className="field-input bday-year"
              inputMode="numeric"
              maxLength={4}
              placeholder={t('birthdayYearOptional')}
              aria-label={t('birthdayYearOptional')}
              aria-invalid={!yearOk}
              value={year}
              onChange={(e) => {
                const y = e.target.value.replace(/\D/g, '')
                setYear(y)
                if (stored && (!y || yearValid(y))) emit(stored.month, stored.day, y)
              }}
            />
            {stored && (
              <button
                className="bday-clear"
                onClick={() => {
                  onChange(undefined)
                  setMonth(undefined)
                  setYear('')
                }}
              >
                {t('birthdayClear')}
              </button>
            )}
          </div>
          {!yearOk && (
            <span className="field-hint error" role="alert">
              {t('birthdayYearInvalid')}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
