import type { Language } from '@shared/types'
import type { CallKind, CallPlatform } from './target'

type Texts = {
  platform: Record<CallPlatform, string>
  kind: Record<CallKind, string>
  minimize: string
  end: string
  opening: string
  pressCall: string
  pickChat: string
  signIn: string
  loadFailed: string
  instagramNone: string
  busy: string
  unavailable: string
  needsSignIn: string
  noChat: string
  /** Said for a caller whose name the dialog did not show. */
  someone: string
}

const EN: Texts = {
  platform: { messenger: 'Messenger', instagram: 'Instagram', zalo: 'Zalo' },
  kind: { audio: 'Voice call', video: 'Video call' },
  minimize: 'Minimize',
  end: 'End call',
  opening: 'Opening the call...',
  pressCall: 'Press the call button on the page',
  pickChat: 'Pick the chat, then press its call button',
  signIn: 'Sign in on the page to call',
  loadFailed: 'The page did not load',
  instagramNone: 'Instagram on the web does not offer calls on this account',
  busy: 'A call is already open. End it first.',
  unavailable: 'Calls are not available for this account.',
  needsSignIn: 'Sign in to this account again before calling.',
  noChat: 'That chat is not available.',
  someone: 'Someone'
}

const VI: Texts = {
  platform: EN.platform,
  kind: { audio: 'Cuộc gọi thoại', video: 'Cuộc gọi video' },
  minimize: 'Thu nhỏ',
  end: 'Kết thúc',
  opening: 'Đang mở cuộc gọi...',
  pressCall: 'Bấm nút gọi trên trang',
  pickChat: 'Chọn hội thoại rồi bấm nút gọi',
  signIn: 'Đăng nhập trên trang để gọi',
  loadFailed: 'Không tải được trang',
  instagramNone: 'Instagram web không hỗ trợ gọi trên tài khoản này',
  busy: 'Đang có một cuộc gọi. Hãy kết thúc nó trước.',
  unavailable: 'Tài khoản này chưa gọi được.',
  needsSignIn: 'Hãy đăng nhập lại tài khoản này trước khi gọi.',
  noChat: 'Không tìm thấy hội thoại này.',
  someone: 'Ai đó'
}

export const callTexts = (language: Language): Texts => (language === 'en' ? EN : VI)
