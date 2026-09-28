import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { useT } from '../store'
import { useKeepInside } from '../popover'

interface Category {
  id: string
  icon: string
  emoji: string[]
}

const CATEGORIES: Category[] = [
  {
    id: 'smileys',
    icon: '😀',
    emoji: '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 🥲 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🫡 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 🥸 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 🥹 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👻 👽 🤖'.split(' ')
  },
  {
    id: 'gestures',
    icon: '👍',
    emoji: '👍 👎 👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👏 🙌 🫶 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🧠 👀 👁️ 👅 👄 🫂 👶 🧑 👩 👨 🧑‍💻 🧑‍🎨 🧑‍🍳 🧑‍🎓 💃 🕺 🧘 🏃 🚶'.split(' ')
  },
  {
    id: 'hearts',
    icon: '❤️',
    emoji: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❤️‍🔥 ❤️‍🩹 💕 💞 💓 💗 💖 💘 💝 💟 ♥️ 💋 💌 💐 🌹 🌷 🌸 💮 🏵️ 🌺 🌻 🌼 ✨ 🌟 💫 ⭐️ 🌈 🔥 💥 🎉 🎊 🎈 🎁 🎀 🏆 🥇 🎯 🍀'.split(' ')
  },
  {
    id: 'animals',
    icon: '🐶',
    emoji: '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐢 🐍 🦎 🐙 🦀 🐠 🐬 🐳 🦈 🐊 🐘 🦒 🐪 🦥 🐿️ 🌵 🎄 🌲 🌴 🍁 🍂 🍃 🌊 🌙 ☀️ ⛅️ ❄️'.split(' ')
  },
  {
    id: 'food',
    icon: '🍜',
    emoji: '🍜 🍲 🍛 🍚 🍙 🍘 🍱 🥟 🍣 🍤 🥘 🍔 🍟 🍕 🌭 🥪 🌮 🌯 🥗 🥙 🧆 🍳 🥞 🧇 🧀 🍗 🥩 🍖 🌽 🥕 🥦 🍅 🍆 🥑 🍎 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍒 🥭 🍍 🥥 🍰 🎂 🧁 🍩 🍪 🍫 🍬 🍭 🍯 ☕️ 🍵 🧋 🥤 🍺 🍻 🥂 🍷 🍸'.split(' ')
  },
  {
    id: 'activity',
    icon: '⚽️',
    emoji: '⚽️ 🏀 🏈 ⚾️ 🎾 🏐 🏉 🎱 🏓 🏸 🥊 🥋 ⛳️ 🏹 🎣 🛹 🛼 🎿 ⛷️ 🏂 🏋️ 🤸 🚴 🏊 🧗 🎮 🕹️ 🎲 🧩 🎨 🎭 🎬 🎤 🎧 🎼 🎹 🥁 🎷 🎸 🎻 📸 🎥 ✈️ 🚀 🚗 🚕 🚌 🚲 🛵 🚂 ⛵️ 🏖️ 🏕️ 🗺️ 🧳'.split(' ')
  },
  {
    id: 'objects',
    icon: '💡',
    emoji: '💡 🔦 🕯️ 📱 💻 ⌨️ 🖥️ 🖨️ 🖱️ 💾 📀 📷 📹 📺 📻 🎙️ ⏰ ⌚️ 📡 🔋 🔌 💰 💳 💎 🔧 🔨 ⚙️ 🧲 🔫 🧨 🔮 📦 📫 📮 📝 📁 📂 📅 📌 📎 ✂️ 📏 🔒 🔑 🗝️ 🛒 🛍️ 🎒 👜 👑 💍 🕶️ 👕 👗 👟 🧢'.split(' ')
  },
  {
    id: 'symbols',
    icon: '✅',
    emoji: '✅ ❌ ❓ ❗️ ‼️ ⁉️ 💯 🔞 ⚠️ 🚫 ♻️ ✳️ ❇️ 🆗 🆕 🆒 🆓 🔝 🔜 🔙 ➡️ ⬅️ ⬆️ ⬇️ ↩️ ↪️ 🔄 🔀 🔁 ▶️ ⏸️ ⏹️ 🔊 🔇 🔔 🔕 💤 💬 💭 🗯️ ♠️ ♣️ ♥️ ♦️ 🏁 🚩 🎌 🏳️‍🌈 🇻🇳 🇺🇸 🇬🇧 🇯🇵 🇰🇷 🇫🇷 🇩🇪'.split(' ')
  }
]

const RECENT_KEY = 'unison.recentEmoji'

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

function saveRecent(list: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 24)))
  } catch {
    /* private mode */
  }
}

interface Props {
  onPick(emoji: string): void
  onClose(): void
}

export function EmojiPicker({ onPick, onClose }: Props): JSX.Element {
  const t = useT()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('recent')
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const ref = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  useKeepInside(ref)

  useEffect(() => {
    input.current?.focus({ preventScroll: true })
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  useEffect(() => {
    if (!recent.length && category === 'recent') setCategory(CATEGORIES[0].id)
  }, [recent.length, category])

  const visible = useMemo(() => {
    const q = query.trim()
    if (q) {
      const all = CATEGORIES.flatMap((c) => c.emoji)
      return all.filter((e) => e.includes(q)).length ? all.filter((e) => e.includes(q)) : all.slice(0, 0)
    }
    if (category === 'recent') return recent
    return CATEGORIES.find((c) => c.id === category)?.emoji ?? []
  }, [query, category, recent])

  const pick = (emoji: string): void => {
    const next = [emoji, ...recent.filter((e) => e !== emoji)]
    setRecent(next)
    saveRecent(next)
    onPick(emoji)
  }

  return (
    <div className="emoji-sheet" ref={ref} role="dialog" aria-label={t('emoji')}>
      <div className="emoji-search">
        <Search size={14} strokeWidth={2.4} />
        <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('searchEmoji')} />
      </div>
      <div className="emoji-tabs">
        {recent.length > 0 && (
          <button className={category === 'recent' && !query ? 'active' : ''} onClick={() => setCategory('recent')} title={t('recent')}>
            🕒
          </button>
        )}
        {CATEGORIES.map((c) => (
          <button key={c.id} className={category === c.id && !query ? 'active' : ''} onClick={() => setCategory(c.id)}>
            {c.icon}
          </button>
        ))}
      </div>
      <div className="emoji-grid scroll">
        {visible.length === 0 && <div className="conv-empty">{t('noResults')}</div>}
        {visible.map((emoji, i) => (
          <button key={`${emoji}-${i}`} onClick={() => pick(emoji)}>
            {emoji}
          </button>
        ))}
      </div>
    </div>
  )
}
