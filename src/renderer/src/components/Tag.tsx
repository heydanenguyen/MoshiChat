import {
  Baby,
  BookOpen,
  Briefcase,
  Camera,
  Code,
  Coffee,
  Dumbbell,
  Flame,
  Flower2,
  Gamepad2,
  Gem,
  Globe,
  GraduationCap,
  Handshake,
  Heart,
  House,
  Leaf,
  Lightbulb,
  MessageCircleHeart,
  MousePointerClick,
  Music,
  Palette,
  PartyPopper,
  PawPrint,
  PenTool,
  Plane,
  Rocket,
  ShoppingBag,
  Sparkles,
  Star,
  Tag as TagGlyph,
  Users,
  Utensils,
  Wallet,
  Zap,
  type LucideIcon
} from 'lucide-react'
import type { TagMeta } from '@shared/types'
import { useStore } from '../store'

/** Line icons offered for tags (name stored in settings). */
export const TAG_ICONS: Record<string, LucideIcon> = {
  briefcase: Briefcase,
  handshake: Handshake,
  heart: Heart,
  house: House,
  star: Star,
  party: PartyPopper,
  sparkles: Sparkles,
  users: Users,
  chat: MessageCircleHeart,
  globe: Globe,
  pointer: MousePointerClick,
  pen: PenTool,
  zap: Zap,
  palette: Palette,
  code: Code,
  rocket: Rocket,
  school: GraduationCap,
  book: BookOpen,
  gym: Dumbbell,
  game: Gamepad2,
  plane: Plane,
  food: Utensils,
  coffee: Coffee,
  camera: Camera,
  music: Music,
  idea: Lightbulb,
  pet: PawPrint,
  baby: Baby,
  money: Wallet,
  shop: ShoppingBag,
  gem: Gem,
  flame: Flame,
  flower: Flower2,
  leaf: Leaf
}

/** The tag's line icon in its colour; older custom tags fall back to their emoji. */
export function TagIcon({ tag, size = 15 }: { tag: TagMeta; size?: number }): JSX.Element {
  const Icon = tag.icon ? TAG_ICONS[tag.icon] : undefined
  if (Icon) return <Icon className="tag-glyph" size={size} strokeWidth={2.3} />
  if (tag.emoji) return <span className="tag-glyph emoji" style={{ fontSize: size - 2 }}>{tag.emoji}</span>
  return <TagGlyph className="tag-glyph" size={size} strokeWidth={2.3} />
}

type ChipSize = 'lg' | 'md' | 'sm' | 'xs'

/**
 * A tag pill: pastel fill of the tag colour with a soft raised edge, line icon and bold label in
 * a deeper shade of the same colour. `muted` renders it quiet (not applied / notifications off).
 */
export function TagChip({
  tag,
  size = 'md',
  muted = false,
  iconOnly = false,
  onClick,
  title,
  children
}: {
  tag: TagMeta
  size?: ChipSize
  muted?: boolean
  iconOnly?: boolean
  onClick?(): void
  title?: string
  children?: React.ReactNode
}): JSX.Element {
  const language = useStore((s) => s.settings.language)
  const iconSize = size === 'lg' ? 18 : size === 'md' ? 15 : size === 'sm' ? 13 : 11
  const className = `tag-pill ${size} ${muted ? 'muted' : ''} ${iconOnly ? 'icon-only' : ''} ${onClick ? 'interactive' : ''}`
  const style = { ['--tag' as string]: tag.color } as React.CSSProperties
  const content = (
    <>
      <TagIcon tag={tag} size={iconSize} />
      {!iconOnly && <span className="tag-pill-label">{tag.name[language]}</span>}
      {children}
    </>
  )
  return onClick ? (
    <button type="button" className={className} style={style} onClick={onClick} title={title ?? tag.name[language]}>
      {content}
    </button>
  ) : (
    <span className={className} style={style} title={title ?? tag.name[language]}>
      {content}
    </span>
  )
}
