import type { Language, WeatherInfo } from '@shared/types'

export interface GreetingLine {
  emoji: string
  text: string
}

interface Context {
  language: Language
  name: string
  weather?: WeatherInfo
  unread: number
  tick: number
}

/** WMO weather code -> emoji + short description. */
export function weatherLabel(w: WeatherInfo, lang: Language): { emoji: string; text: string; temp: string; short: string } {
  const vi = lang === 'vi'
  const c = w.code
  let emoji = w.isDay ? '☀️' : '🌙'
  let text = vi ? 'trời quang' : 'clear skies'
  if (c === 1 || c === 2) {
    emoji = w.isDay ? '🌤️' : '☁️'
    text = vi ? 'ít mây' : 'a few clouds'
  } else if (c === 3) {
    emoji = '☁️'
    text = vi ? 'nhiều mây' : 'overcast'
  } else if (c === 45 || c === 48) {
    emoji = '🌫️'
    text = vi ? 'sương mù' : 'foggy'
  } else if (c >= 51 && c <= 57) {
    emoji = '🌦️'
    text = vi ? 'mưa phùn' : 'drizzle'
  } else if (c >= 61 && c <= 67) {
    emoji = '🌧️'
    text = vi ? 'mưa' : 'rain'
  } else if (c >= 71 && c <= 77) {
    emoji = '❄️'
    text = vi ? 'tuyết' : 'snow'
  } else if (c >= 80 && c <= 82) {
    emoji = '🌧️'
    text = vi ? 'mưa rào' : 'showers'
  } else if (c >= 85 && c <= 86) {
    emoji = '🌨️'
    text = vi ? 'mưa tuyết' : 'snow showers'
  } else if (c >= 95) {
    emoji = '⛈️'
    text = vi ? 'dông' : 'thunderstorms'
  }
  const temp = `${w.temperature}°C`
  const place = w.city || (vi ? 'chỗ bạn' : 'your place')
  return { emoji, text, temp, short: `${place} ${temp}` }
}

function pick<T>(list: T[], seed: number): T {
  return list[Math.abs(seed) % list.length]
}

/** A cheerful, context-aware line. Deterministic per tick so re-renders don't flicker. */
export function greetingFor(ctx: Context): GreetingLine {
  const vi = ctx.language === 'vi'
  const hour = new Date().getHours()
  const name = ctx.name
  const you = name || (vi ? 'bạn' : 'you')
  const hey = name ? (vi ? `${name} ơi` : `Hey ${name}`) : vi ? 'Này bạn' : 'Hey'
  const w = ctx.weather
  const lines: GreetingLine[] = []

  // Time of day
  if (hour < 5) lines.push({ emoji: '🌙', text: vi ? `${hey}, khuya rồi, nhắn nốt rồi nghỉ nhé` : `${hey}, it's late. One more message, then rest` })
  else if (hour < 11) lines.push({ emoji: '☀️', text: vi ? `Chào buổi sáng, ${you}! Hôm nay sẽ là một ngày tuyệt vời` : `Good morning, ${you}! Today is going to be a good one` })
  else if (hour < 14) lines.push({ emoji: '🍜', text: vi ? `${hey}, ăn trưa chưa? Đừng để bụng đói đi làm việc` : `${hey}, had lunch yet? Don't skip it` })
  else if (hour < 18) lines.push({ emoji: '⚡️', text: vi ? `Buổi chiều hiệu quả nhé, ${you}` : `Have a productive afternoon, ${you}` })
  else if (hour < 22) lines.push({ emoji: '🌆', text: vi ? `Chào buổi tối, ${you}. Cuộc trò chuyện nào cũng đáng giá` : `Good evening, ${you}. Every conversation counts` })
  else lines.push({ emoji: '✨', text: vi ? `${hey}, ngày hôm nay bạn làm tốt lắm` : `${hey}, you did great today` })

  // Compliments and nudges
  lines.push(
    { emoji: '💛', text: vi ? `${hey}, bạn tuyệt vời lắm!` : `${hey}, you are awesome!` },
    { emoji: '🌱', text: vi ? `Mỗi tin nhắn tử tế là một hạt giống, ${you} nhé` : `Every kind message is a seed, ${you}` },
    { emoji: '🎧', text: vi ? `Bật một bài hay rồi trả lời tin nhắn thôi` : `Put on a good song and clear that inbox` },
    { emoji: '💧', text: vi ? `Uống một ngụm nước nào, ${you}` : `Time for a sip of water, ${you}` },
    { emoji: '🧘', text: vi ? `Hít sâu. Thở ra. Mọi thứ đều ổn` : `Breathe in. Breathe out. All good` },
    { emoji: '🚀', text: vi ? `${hey}, hôm nay có gì hay không? Kể cho ai đó nghe đi` : `${hey}, anything exciting today? Tell someone` }
  )

  if (ctx.unread > 0) {
    lines.push({ emoji: '💬', text: vi ? `${ctx.unread} tin đang chờ ${you}. Từng cái một thôi` : `${ctx.unread} messages are waiting for ${you}. One at a time` })
  } else {
    lines.push({ emoji: '🎉', text: vi ? `Hộp thư sạch bong. Đỉnh quá, ${you}!` : `Inbox zero. Nicely done, ${you}!` })
  }

  // Weather-aware
  if (w) {
    const label = weatherLabel(w, ctx.language)
    const place = w.city || (vi ? 'Chỗ bạn' : 'Your place')
    const t = w.temperature
    if (w.code >= 61 && w.code < 95) {
      lines.push({ emoji: label.emoji, text: vi ? `${place} đang ${label.text}, ${label.temp}. Mang ô nhé, ${you}` : `${label.text[0].toUpperCase() + label.text.slice(1)} in ${place}, ${label.temp}. Bring an umbrella, ${you}` })
    } else if (w.code >= 95) {
      lines.push({ emoji: label.emoji, text: vi ? `${place} có dông, ${label.temp}. Ở trong nhà nhắn tin cho ấm` : `Thunderstorms in ${place}, ${label.temp}. Stay in and text someone` })
    } else if (t >= 33) {
      lines.push({ emoji: '🥵', text: vi ? `${place} ${label.temp} rồi. Nước mát và điều hoà, ${you} ơi` : `${place} is ${label.temp}. Cold drinks and AC, ${you}` })
    } else if (t >= 24 && w.isDay) {
      lines.push({ emoji: '🚴', text: vi ? `${place} đang ${label.temp}, ${label.text}. Đi một vòng thôi!` : `${label.temp} and ${label.text} in ${place}. Time for a ride!` })
    } else if (t >= 15) {
      lines.push({ emoji: label.emoji, text: vi ? `${place} ${label.temp}, ${label.text}. Thời tiết đẹp để đi dạo` : `${label.temp} and ${label.text} in ${place}. Perfect for a walk` })
    } else {
      lines.push({ emoji: '🧣', text: vi ? `${place} chỉ ${label.temp}. Khoác thêm áo nhé, ${you}` : `Only ${label.temp} in ${place}. Grab a jacket, ${you}` })
    }
    if (!w.isDay) lines.push({ emoji: '🌙', text: vi ? `${place} về đêm ${label.temp}. Ngủ ngon sớm nhé` : `${place} tonight: ${label.temp}. Sleep well soon` })
  }

  // Rotate: weather lines get a bit more airtime.
  const weighted = w ? [...lines, ...lines.slice(-2)] : lines
  const daySeed = new Date().getDate() * 7
  return pick(weighted, ctx.tick + daySeed)
}

/** The person's first name from their accounts, preferring a real account over sample data. */
export function firstNameOf(accounts: Array<{ displayName?: string; demo?: boolean }>): string {
  const real = accounts.find((a) => !a.demo && a.displayName) ?? accounts[0]
  const name = real?.displayName?.trim() ?? ''
  if (!name) return ''
  const parts = name.split(/\s+/)
  // Vietnamese names put the given name last; western ones first.
  const vietnamese = /[ăâđêôơưàáảãạèéẻẽẹìíỉĩịòóỏõọùúủũụỳýỷỹỵ]/i.test(name) || parts.length >= 3
  return vietnamese ? parts[parts.length - 1] : parts[0]
}

/**
 * What the logo character says on the launch screen: a line for the time of day or a general
 * friendly one. `pickSplashLine` chooses one at random each launch.
 */
export function splashLines(language: Language, name: string, hour: number): GreetingLine[] {
  const vi = language === 'vi'
  const you = name || (vi ? 'bạn' : 'friend')
  const hi = name ? (vi ? `${name} ơi` : `Hi ${name}`) : vi ? 'Xin chào' : 'Hi there'
  const lines: GreetingLine[] = []
  const add = (emoji: string, v: string, e: string): void => void lines.push({ emoji, text: vi ? v : e })

  if (hour < 5) {
    add('🌙', `Khuya rồi đó ${you}, nhắn xíu rồi ngủ nha`, `It's late, ${you}. A few messages, then sleep`)
    add('🦉', `Cú đêm ${you} đã quay lại!`, `The night owl is back, ${you}!`)
    add('✨', `${hi}, sao đêm nay đẹp ghê`, `${hi}, the stars look lovely tonight`)
  } else if (hour < 11) {
    add('☀️', `Chào buổi sáng, ${you}!`, `Good morning, ${you}!`)
    add('☕️', `Cà phê chưa ${you}? Mình pha sẵn tin nhắn rồi nè`, `Coffee yet, ${you}? Your messages are brewed`)
    add('🌤️', `Một ngày mới xinh xắn đang chờ ${you} đó`, `A brand new day is waiting for you, ${you}`)
    add('🥐', `${hi}, ăn sáng đầy đủ chưa đó?`, `${hi}, did you have breakfast?`)
  } else if (hour < 14) {
    add('🍜', `${hi}, trưa rồi, nhớ ăn cơm nha`, `${hi}, it's lunchtime. Don't skip it`)
    add('😋', `Ăn trưa xong mình tám tiếp nhé ${you}`, `Lunch first, then let's chat, ${you}`)
    add('🌞', `Nắng trưa rực rỡ như ${you} vậy`, `The midday sun is as bright as you, ${you}`)
  } else if (hour < 18) {
    add('⚡️', `Buổi chiều năng lượng nha ${you}!`, `Have an energetic afternoon, ${you}!`)
    add('🧋', `${hi}, làm ly trà sữa cho tỉnh táo không?`, `${hi}, bubble tea break?`)
    add('🌻', `Chiều nay có ai đang nhớ ${you} đó`, `Someone is thinking of you this afternoon, ${you}`)
  } else if (hour < 22) {
    add('🌆', `Chào buổi tối, ${you}!`, `Good evening, ${you}!`)
    add('🍲', `${hi}, ăn tối chưa? Kể mình nghe hôm nay thế nào`, `${hi}, had dinner? Tell me about your day`)
    add('🎶', `Tối nay thư giãn và trò chuyện thôi ${you}`, `Time to relax and catch up, ${you}`)
  } else {
    add('🌙', `${hi}, hôm nay ${you} làm tốt lắm rồi`, `${hi}, you did great today`)
    add('🛌', `Nhắn nốt vài câu rồi đi ngủ sớm nha ${you}`, `A few more messages, then bedtime, ${you}`)
    add('⭐️', `Chúc ${you} một buổi tối thật êm`, `Wishing you a cosy night, ${you}`)
  }

  add('👋', `${hi}! Mình nhớ bạn ghê`, `${hi}! I missed you`)
  add('💛', `Yay, ${you} quay lại rồi!`, `Yay, you're back${name ? `, ${name}` : ''}!`)
  add('🎈', `Chào mừng trở lại, ${you}!`, `Welcome back, ${you}!`)
  add('🤗', `Ôm ${you} một cái nè`, `Here's a big hug, ${you}`)
  add('💬', `Mọi người đang chờ ${you} đó, vào thôi!`, `Everyone's waiting for you, ${you}. Let's go!`)
  add('🌈', `Hôm nay mình trò chuyện thật vui nha ${you}`, `Let's have fun conversations today, ${you}`)
  add('🍀', `Chúc ${you} một ngày may mắn`, `Wishing you a lucky day, ${you}`)
  add('😊', `${hi}, cười lên một cái nào`, `${hi}, give me a smile`)
  add('🚀', `Sẵn sàng chưa ${you}? Mình gom hết tin nhắn rồi`, `Ready, ${you}? I've gathered all your messages`)
  add('🫶', `Có ${you} ở đây vui hẳn`, `It's better with you here, ${you}`)
  return lines
}

/** A random launch line, avoiding the text shown last time. */
export function pickSplashLine(language: Language, name: string, hour: number, avoid?: string, random = Math.random): GreetingLine {
  const lines = splashLines(language, name, hour)
  const pool = lines.length > 1 && avoid ? lines.filter((l) => l.text !== avoid) : lines
  return pool[Math.floor(random() * pool.length) % pool.length]
}
