import { useEffect, useState } from 'react'
import { Phone, PhoneCall, PhoneOff, Video } from 'lucide-react'
import type { IncomingCall } from '@shared/types'
import { PLATFORMS } from '@shared/types'
import { useStore, useT } from '../store'
import { ringDeadline } from '../calls'
import { startRing } from '../sounds'
import { usePresenceList } from '../usePresence'
import { Avatar } from './Avatar'
import { PlatformIcon } from './PlatformIcon'
import { isQuietStyle } from '../rowState'
import { newestIncoming, pillCallId } from '../motion/island'
import { CallIsland } from './CallIsland'

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

/**
 * The call island (idea 16) shows the newest ringing call and the call in progress; any older ringing calls wait below it as cards.
 * Also plays the ring while a call rings.
 */
export function IncomingCallBanner(): JSX.Element {
  const incoming = useStore((s) => s.calls.incoming)
  const entries = usePresenceList(incoming, callKey)
  useRing(incoming)
  // The pill shows the newest ringing call; one that leaves while it was the newest goes with the pill's own morph (no card exit).
  const newestId = newestIncoming(incoming)?.id
  const leavingId = pillCallId(entries.map((e) => e.item))
  const overflow = entries.filter(({ item, closing }) => item.id !== newestId && !(closing && item.id === leavingId))
  return (
    <>
      <CallIsland />
      {overflow.length > 0 && (
        <div className="call-banners call-overflow">
          {overflow.map(({ item, closing }) => (
            <CallCard key={item.id} call={item} closing={closing} />
          ))}
        </div>
      )}
    </>
  )
}

/** The in-call strip was folded into the island; this stays only so its mount point in the conversation list renders nothing. */
export function ActiveCallStrip(): null {
  return null
}
