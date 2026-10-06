import type { ReactNode } from 'react'
import { AlarmClock, Cake, Clock, Flame, ListChecks, Send } from 'lucide-react'
import { useT } from '../store'

/**
 * Feature switches as cards: a small drawing of where the feature shows up in Moshi (in the app's own look, from
 * its colour tokens), its name, one line on what it does, and the switch. Off, the drawing dims, the feature's place
 * is left as an empty dashed outline and an "Off" tag shows, so what turning it off removes is plain before reading
 * a word. The whole card is the switch.
 */
export function FeatureGrid({ children }: { children: ReactNode }): JSX.Element {
  return <div className="feature-grid">{children}</div>
}

export function FeatureCard({ title, sub, on, onChange, demo }: { title: string; sub: string; on: boolean; onChange(next: boolean): void; demo: ReactNode }): JSX.Element {
  const offLabel = useT()('featureOff')
  return (
    <button type="button" role="switch" aria-checked={on} title={sub} className={`feature-card ${on ? 'on' : 'off'}`} onClick={() => onChange(!on)}>
      <span className="feature-demo" aria-hidden>
        {demo}
        <span className="feature-state">{offLabel}</span>
      </span>
      <span className="feature-foot">
        <span className="feature-text">
          <span className="feature-name">{title}</span>
          <span className="feature-sub">{sub}</span>
        </span>
        <span className={`switch ${on ? 'on' : ''}`} aria-hidden />
      </span>
    </button>
  )
}

/* ---------------------------------------------------------------- drawings: `.feat` is what the switch controls */

const ICON = { size: 11, strokeWidth: 2.4 }

/** A person's details with their private note card. */
export function NoteDemo(): JSX.Element {
  return (
    <span className="fd fd-details">
      <span className="fd-person">
        <i className="fd-avatar" />
        <span className="fd-lines">
          <i className="fd-line w60 strong" />
          <i className="fd-line w40" />
        </span>
      </span>
      <span className="fd-note feat">
        <i className="fd-line w80" />
        <i className="fd-line w60" />
      </span>
    </span>
  )
}

/** The composer with its clock for sending later. */
export function ScheduleDemo(): JSX.Element {
  return (
    <span className="fd fd-chat">
      <span className="fd-bubble in w55" />
      <span className="fd-composer">
        <i className="fd-line w45" />
        <span className="fd-chip feat">
          <Clock {...ICON} />
        </span>
        <span className="fd-send">
          <Send size={10} strokeWidth={2.6} />
        </span>
      </span>
    </span>
  )
}

/** A chat's header alarm and a snoozed chat in the list. */
export function LaterDemo(): JSX.Element {
  return (
    <span className="fd fd-list">
      <span className="fd-header">
        <i className="fd-avatar sm" />
        <i className="fd-line w35 strong" />
        <span className="fd-chip feat">
          <AlarmClock {...ICON} />
        </span>
      </span>
      <span className="fd-row">
        <i className="fd-avatar sm" />
        <i className="fd-line w30" />
        <span className="fd-pill feat">
          <AlarmClock size={9} strokeWidth={2.6} />
          9:00
        </span>
      </span>
    </span>
  )
}

/** The sidebar with its to-do list. */
export function TodosDemo(): JSX.Element {
  return (
    <span className="fd fd-sidebar">
      <span className="fd-nav">
        <i className="fd-dot" />
        <i className="fd-line w55" />
      </span>
      <span className="fd-nav active feat">
        <span className="fd-navicon">
          <ListChecks {...ICON} />
        </span>
        <i className="fd-line w45 strong" />
        <span className="fd-count">3</span>
      </span>
      <span className="fd-nav">
        <i className="fd-dot" />
        <i className="fd-line w40" />
      </span>
    </span>
  )
}

/** Close friends in the sidebar, with a streak. */
export function FriendsDemo(): JSX.Element {
  return (
    <span className="fd fd-sidebar">
      <span className="fd-nav">
        <i className="fd-dot" />
        <i className="fd-line w50" />
      </span>
      <span className="fd-friends feat">
        <i className="fd-avatar sm a1" />
        <i className="fd-avatar sm a2" />
        <i className="fd-avatar sm a3" />
        <span className="fd-streak">
          <Flame size={10} strokeWidth={2.6} />
          12
        </span>
      </span>
    </span>
  )
}

/** The morning notification on someone's birthday. */
export function BirthdayDemo(): JSX.Element {
  return (
    <span className="fd fd-desktop">
      <span className="fd-toast feat">
        <span className="fd-toast-icon">
          <Cake {...ICON} />
        </span>
        <span className="fd-lines">
          <i className="fd-line w60 strong" />
          <i className="fd-line w80" />
        </span>
      </span>
      <span className="fd-bubble in w45" />
    </span>
  )
}
