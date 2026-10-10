import { useEffect, useRef, useState } from 'react'
import { Phone, PhoneCall, PhoneOff, Video } from 'lucide-react'
import type { CallState, IncomingCall } from '@shared/types'
import { PLATFORMS } from '@shared/types'
import { useStore, useT } from '../store'
import { callTimer, ringDeadline } from '../calls'
import { startRing } from '../sounds'
import { usePresence, usePresenceList } from '../usePresence'
import { Avatar } from './Avatar'
import { PlatformIcon } from './PlatformIcon'
import { isQuietStyle } from '../rowState'

const callKey = (call: IncomingCall): string => call.id

/** Rings while a call is ringing and the ring is on in Settings: 30 s after the earliest call began, at the notification volume. */
function useRing(calls: readonly IncomingCall[]): void {
  const settings = useStore((s) => s.settings.calls)
  const volume = useStore((s) => s.settings.soundVolume ?? 0.7)
  const ids = calls.map(callKey).join('\n')
  useEffect(() => {
    const stopAt = ringDeadline(calls, settings, Date.now())
    if (stopAt === undefined) return
    return startRing(volume, stopAt)
    // Keyed by the set of ringing calls (not the array identity), so an unrelated state change does not restart the ring.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, settings, volume])
}

/** One ringing call: who, on which app, voice or video, and the two answers. */
function CallCard({ call, closing }: { call: IncomingCall; closing: boolean }): JSX.Element {
  const t = useT()
  const answerCall = useStore((s) => s.answerCall)
  const declineCall = useStore((s) => s.declineCall)
  // One tap each: the buttons rest until the main process reports the call gone (or an error toast comes back).
  const [busy, setBusy] = useState(false)
  const act = (run: (id: string) => Promise<void>): void => {
    setBusy(true)
    void run(call.id).finally(() => setBusy(false))
  }
  const label = call.kind === 'video' ? t('callIncomingVideo') : t('callIncomingVoice')
  // The default style shows the two answers as round glyph buttons (text kept for screen readers and as the tooltip).
  const quiet = useStore((s) => isQuietStyle(s.settings.style))
  return (
    <div className="call-card" data-state={closing ? 'closing' : 'open'} role="alert" aria-label={`${label}: ${call.peerName}`}>
      <span className="call-card-avatar">
        <Avatar name={call.peerName} url={call.peerAvatarUrl} size={44} platform={call.platform} />
        <i className="call-ring" aria-hidden />
      </span>
      <div className="call-card-info">
        <div className="call-card-name">{call.peerName}</div>
        <div className="call-card-sub">
          <span className="call-card-chip">
            <PlatformIcon platform={call.platform} size={14} />
            {PLATFORMS[call.platform].name}
          </span>
          <span className="call-card-kind">
            {call.kind === 'video' ? <Video size={13} strokeWidth={2.2} /> : <PhoneCall size={13} strokeWidth={2.2} />}
            {quiet ? label : call.kind === 'video' ? t('callVideo') : t('callVoice')}
          </span>
        </div>
      </div>
      <div className="call-card-actions">
        <button type="button" className="btn secondary call-decline" title={quiet ? t('callDecline') : undefined} disabled={busy || closing} onClick={() => act(declineCall)}>
          <PhoneOff size={15} strokeWidth={2.2} />
          <span className="call-card-glyph" aria-hidden>
            <Phone size={20} strokeWidth={2} />
          </span>
          <span className="call-card-btn-text">{t('callDecline')}</span>
        </button>
        <button type="button" className="btn primary call-answer" title={quiet ? t('callAnswer') : undefined} disabled={busy || closing} onClick={() => act(answerCall)}>
          {call.kind === 'video' ? <Video size={15} strokeWidth={2.2} /> : <PhoneCall size={15} strokeWidth={2.2} />}
          <span className="call-card-glyph" aria-hidden>
            {call.kind === 'video' ? <Video size={20} strokeWidth={2} /> : <Phone size={20} strokeWidth={2} />}
          </span>
          <span className="call-card-btn-text">{t('callAnswer')}</span>
        </button>
      </div>
    </div>
  )
}

/** Every call that is ringing (usually one), top right, until it is answered, declined or gone; each plays its exit. */
export function IncomingCallBanner(): JSX.Element | null {
  const incoming = useStore((s) => s.calls.incoming)
  const entries = usePresenceList(incoming, callKey)
  useRing(incoming)
  if (!entries.length) return null
  return (
    <div className="call-banners">
      {entries.map(({ item, closing }) => (
        <CallCard key={item.id} call={item} closing={closing} />
      ))}
    </div>
  )
}

/** The clock, ticking once a second. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

function useConversationTitle(id: string | undefined): string | undefined {
  return useStore((s) => (id ? s.conversations[id]?.title : undefined))
}

function StripBody({ call, closing }: { call: NonNullable<CallState['active']>; closing: boolean }): JSX.Element {
  const t = useT()
  const name = useConversationTitle(call.conversationId) ?? PLATFORMS[call.platform].name
  const endCall = useStore((s) => s.endCall)
  const quiet = useStore((s) => isQuietStyle(s.settings.style))
  const now = useNow()
  return (
    <div className="call-strip" data-state={closing ? 'closing' : 'open'}>
      <button type="button" className="call-strip-main" title={t('callBackTo')} onClick={() => void window.unison.calls.focus().catch(() => undefined)}>
        <span className="call-strip-dot" aria-hidden />
        <span className="call-strip-text">{t('callInCallWith', { name })}</span>
        <span className="call-strip-time">{callTimer(call.startedAt, now)}</span>
      </button>
      <button type="button" className="call-strip-end" title={quiet ? t('callEnd') : undefined} disabled={closing} onClick={() => void endCall()}>
        <PhoneOff size={14} strokeWidth={2.2} />
        <span className="call-strip-end-text">{t('callEnd')}</span>
      </button>
    </div>
  )
}

/** The call in progress as a slim strip above the conversation list: click to get back to its window, or end it. */
export function ActiveCallStrip(): JSX.Element | null {
  const active = useStore((s) => s.calls.active)
  const last = useRef(active)
  if (active) last.current = active
  const { mounted, state } = usePresence(!!active)
  if (!mounted || !last.current) return null
  return <StripBody call={last.current} closing={state === 'closing'} />
}
