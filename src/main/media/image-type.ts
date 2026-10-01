/** The picture type of a file by its first bytes, or undefined if it is not a picture Moshi shows. */
export function imageTypeOf(body: Buffer): string | undefined {
  if (body.subarray(0, 4).toString('latin1') === 'RIFF' && body.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  if (body[0] === 0x89 && body.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png'
  if (body.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif'
  if (body[0] === 0xff && body[1] === 0xd8) return 'image/jpeg'
  return undefined
}
