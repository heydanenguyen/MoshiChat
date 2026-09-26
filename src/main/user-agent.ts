/**
 * A plain desktop Chrome user agent matching the bundled Chromium version,
 * without the "Electron/…" and app-name tokens Electron adds by default.
 * Used for Facebook, where the login window and ws3-fca must look identical.
 */
export function browserUserAgent(): string {
  const major = (process.versions.chrome ?? '130').split('.')[0]
  const platform =
    process.platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : process.platform === 'win32'
        ? 'Windows NT 10.0; Win64; x64'
        : 'X11; Linux x86_64'
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
}
