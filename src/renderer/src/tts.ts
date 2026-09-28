/**
 * Read a message aloud. System voices (Windows / macOS) speak instantly when one exists for the
 * language; otherwise the on-device MMS-TTS model (downloaded once) makes the audio and it plays here.
 */
let current: { stop(): void } | undefined

const langTag = (lang: string): string => (lang === 'vi' ? 'vi' : lang === 'en' ? 'en' : lang)

/** Chromium fills the voice list asynchronously; wait for it once (briefly) instead of assuming there are none. */
export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof speechSynthesis === 'undefined') return Promise.resolve([])
  const now = speechSynthesis.getVoices()
  if (now.length) return Promise.resolve(now)
  return new Promise((resolve) => {
    const done = (): void => {
      speechSynthesis.removeEventListener('voiceschanged', done)
      resolve(speechSynthesis.getVoices())
    }
    speechSynthesis.addEventListener('voiceschanged', done)
    setTimeout(done, 700)
  })
}
if (typeof speechSynthesis !== 'undefined') void loadVoices()

/** A system voice for this language, preferring "natural"/online ones and the app's own language. */
export async function systemVoice(lang: string): Promise<SpeechSynthesisVoice | undefined> {
  const tag = langTag(lang)
  const voices = (await loadVoices()).filter((v) => v.lang.toLowerCase().startsWith(tag))
  return voices.find((v) => /natural|neural/i.test(v.name)) ?? voices.find((v) => v.localService) ?? voices[0]
}

export function stopSpeaking(): void {
  current?.stop()
  current = undefined
}

/** Speak with a system voice. Resolves when done (or stopped). */
export function speakWithSystem(text: string, voice: SpeechSynthesisVoice): Promise<void> {
  stopSpeaking()
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.voice = voice
    utterance.lang = voice.lang
    utterance.rate = 1
    utterance.onend = () => {
      current = undefined
      resolve()
    }
    utterance.onerror = () => {
      current = undefined
      resolve()
    }
    current = { stop: () => speechSynthesis.cancel() }
    speechSynthesis.speak(utterance)
  })
}

/** Play PCM from the on-device model. Resolves when done (or stopped). */
export function playPcm(audio: Float32Array, rate: number): Promise<void> {
  stopSpeaking()
  const ctx = new AudioContext()
  const buffer = ctx.createBuffer(1, audio.length, rate)
  buffer.copyToChannel(new Float32Array(audio), 0)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)
  return new Promise((resolve) => {
    const finish = (): void => {
      current = undefined
      void ctx.close()
      resolve()
    }
    source.onended = finish
    current = {
      stop: () => {
        try {
          source.stop()
        } catch {
          /* already stopped */
        }
        finish()
      }
    }
    source.start()
  })
}
