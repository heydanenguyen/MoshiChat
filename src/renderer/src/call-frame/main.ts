// The bar over a call window. Kept in step with FrameInfo in src/main/calls/ipc.ts (the main process sends it, already translated).
interface FrameInfo {
  name: string
  platformLabel: string
  kindLabel: string
  avatarUrl?: string
  startedAt: number
  hint?: string
  minimizeLabel: string
  endLabel: string
}

export {}

declare global {
  interface Window {
    callFrame: { end(): void; minimize(): void; onState(handler: (info: FrameInfo) => void): void }
  }
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

// The same remembered theme the launch screen reads (localStorage 'unison.splash'); the system's when there is none yet.
function theme(): 'light' | 'dark' {
  try {
    const saved = (JSON.parse(localStorage.getItem('unison.splash') ?? '{}') as { theme?: string }).theme
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // unreadable: follow the system
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
document.documentElement.dataset.theme = theme()

let startedAt = Date.now()
const clock = (): void => {
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  const pad = (n: number): string => String(n).padStart(2, '0')
  $('clock').textContent = seconds >= 3600 ? `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}` : `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`
}
setInterval(clock, 1000)

let shown = ''

function show(info: FrameInfo): void {
  startedAt = info.startedAt
  $('name').textContent = info.name
  $('sub').textContent = info.hint ?? `${info.platformLabel} · ${info.kindLabel}`
  $('min').title = info.minimizeLabel
  $('min').setAttribute('aria-label', info.minimizeLabel)
  $('end').textContent = info.endLabel
  // The hint changes while the call is set up; the picture need not be drawn again for it.
  const key = `${info.name}|${info.avatarUrl ?? ''}`
  if (key === shown) return clock()
  shown = key
  const avatar = $('avatar')
  const initial = (): void => {
    avatar.replaceChildren(document.createTextNode(Array.from(info.name.trim())[0]?.toUpperCase() ?? ''))
  }
  if (info.avatarUrl) {
    const img = new Image()
    img.alt = ''
    img.onerror = initial
    img.src = info.avatarUrl
    avatar.replaceChildren(img)
  } else initial()
  clock()
}

$('min').addEventListener('click', () => window.callFrame.minimize())
$('end').addEventListener('click', () => window.callFrame.end())
window.callFrame.onState(show)
