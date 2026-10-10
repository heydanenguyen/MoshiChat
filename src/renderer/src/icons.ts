/**
 * One stroke weight for the line icons (UI direction A): lucide's default of 2 is a little heavy beside 13-14 px text.
 * The Moshi style draws every lucide icon in the sidebar, list and chat header at this weight (app.css sets it from
 * `--icon-stroke`, so Liquid, Mono and Pals keep the weights they were drawn with); new icons take it from here.
 */
export const ICON_STROKE = 1.75

/** Props for a new lucide icon: `<Check {...icon(16)} />`. */
export const icon = (size: number): { size: number; strokeWidth: number } => ({ size, strokeWidth: ICON_STROKE })
