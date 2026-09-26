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

/** CSS variables for a tag: ink for label/icon, fill for the slab. */
export function tagStyle(tag: Pick<TagMeta, 'color' | 'fill'>): React.CSSProperties {
  return { ['--tag' as string]: tag.color, ...(tag.fill ? { ['--tag-fill' as string]: tag.fill } : {}) } as React.CSSProperties
}

/**
 * A tag pill in the pastel "slab" style: solid fill with no outline, a light top highlight, a deeper
 * bottom lip and a soft tinted shadow; line icon and label in the tag's ink colour.
 * `flat` = not applied (paler, no lip), `selected` = the current filter.
 */
export function TagChip({
  tag,
  size = 'md',
  flat = false,
  selected = false,
  iconOnly = false,
  count,
  dot = false,
  onClick,
  onContextMenu,
  title,
  children
}: {
  tag: TagMeta
  size?: ChipSize
  flat?: boolean
  selected?: boolean
  iconOnly?: boolean
  /** Small number after the label (for example how many chats carry the tag). */
  count?: number
  /** Unread marker in the corner. */
  dot?: boolean
  onClick?(): void
  onContextMenu?(e: React.MouseEvent): void
  title?: string
  children?: React.ReactNode
}): JSX.Element {
  const language = useStore((s) => s.settings.language)
  const iconSize = size === 'lg' ? 19 : size === 'md' ? 15 : size === 'sm' ? 13 : 11
  const className = ['tag-pill', size, flat && 'flat', selected && 'selected', iconOnly && 'icon-only', onClick && 'interactive'].filter(Boolean).join(' ')
  const label = tag.name[language]
  const content = (
    <>
      <TagIcon tag={tag} size={iconSize} />
      {!iconOnly && <span className="tag-pill-label">{label}</span>}
      {!iconOnly && count !== undefined && <span className="tag-pill-count">{count}</span>}
      {children}
      {dot && <span className="tag-pill-dot" />}
    </>
  )
  return onClick ? (
    <button type="button" className={className} style={tagStyle(tag)} onClick={onClick} onContextMenu={onContextMenu} title={title ?? label} aria-pressed={selected || !flat}>
      {content}
    </button>
  ) : (
    <span className={className} style={tagStyle(tag)} title={title ?? label} onContextMenu={onContextMenu}>
      {content}
    </span>
  )
}
