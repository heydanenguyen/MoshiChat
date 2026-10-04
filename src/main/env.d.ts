/** Build-time constants (electron.vite.config.ts `define`). */
declare const __MOSHI_GIF_KEY__: string
declare const __MOSHI_GIF_PROVIDER__: 'klipy' | 'giphy'

/** Files bundled into the main build as text (Vite `?raw`). */
declare module '*?raw' {
  const text: string
  export default text
}
