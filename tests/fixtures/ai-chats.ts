import type { ChatContext, Intent } from '../../src/shared/ai-context'

/**
 * Chats for checking the reply suggestions: everyday Vietnamese (and some English) across the relationships people
 * actually message in, each with what the answer should know (pronouns, the kind of message). Invented people.
 */
export interface Fixture {
  id: string
  context: ChatContext
  expect: { intent: Intent; self?: string; other?: string }
  /** [mine, text], oldest first; the last line is the one being answered. */
  lines: Array<[boolean, string]>
}

export const FIXTURES: Fixture[] = [
  {
    id: 'shop-good-news',
    context: { me: 'Minh Anh', them: 'Chị Hạnh', tags: ['Công việc'] },
    expect: { intent: 'good_news', self: 'em', other: 'chị' },
    lines: [
      [false, 'Em ơi lô hàng tuần này còn size M không?'],
      [true, 'Dạ còn 40 cái chị, em giữ cho chị 20 nhé'],
      [false, 'Ok em, chuyển khoản luôn nha'],
      [true, 'Dạ em nhận được rồi ạ'],
      [false, 'À con chị vừa đậu đại học rồi em ơi, vui quá']
    ]
  },
  {
    id: 'shop-request-price',
    context: { me: 'Minh Anh', them: 'Anh Tuấn', tags: ['Khách sỉ'] },
    expect: { intent: 'request', self: 'em', other: 'anh' },
    lines: [
      [false, 'Shop ơi áo thun basic còn màu trắng không em'],
      [true, 'Dạ còn anh ơi, anh lấy size gì ạ'],
      [false, 'Anh lấy 50 cái size L, em báo giá sỉ giúp anh nhé']
    ]
  },
  {
    id: 'mom-question',
    context: { me: 'Lan', them: 'Mẹ', tags: ['Gia đình'] },
    expect: { intent: 'question', self: 'con', other: 'mẹ' },
    lines: [
      [false, 'Con đi làm về chưa'],
      [true, 'Con về rồi mẹ ơi'],
      [false, 'Tối nay con có về ăn cơm không?']
    ]
  },
  {
    id: 'mom-worry',
    context: { me: 'Lan', them: 'Mẹ', tags: ['Gia đình'] },
    expect: { intent: 'bad_news', self: 'con', other: 'mẹ' },
    lines: [
      [true, 'Mẹ ơi con gửi tiền cho mẹ rồi nhé'],
      [false, 'Ừ mẹ nhận rồi'],
      [false, 'Mấy hôm nay bố con bị ốm, mẹ lo quá']
    ]
  },
  {
    id: 'dad-invite',
    context: { me: 'Hùng', them: 'Bố', tags: ['Gia đình'] },
    expect: { intent: 'invite', self: 'con', other: 'bố' },
    lines: [
      [true, 'Bố ơi cuối tuần con về nhé'],
      [false, 'Ừ về đi con'],
      [false, 'Chủ nhật cả nhà đi ăn lẩu không?']
    ]
  },
  {
    id: 'sister-thanks',
    context: { me: 'Nam', them: 'Bé Mai', tags: ['Gia đình'] },
    expect: { intent: 'thanks', self: 'anh', other: 'em' },
    lines: [
      [false, 'Anh ơi chuyển giúp em 500k với'],
      [true, 'Anh chuyển rồi đó em'],
      [false, 'Em cảm ơn anh nhiều nha']
    ]
  },
  {
    id: 'brother-bad',
    context: { me: 'Mai', them: 'Anh Nam', tags: ['Gia đình'] },
    expect: { intent: 'bad_news', self: 'em', other: 'anh' },
    lines: [
      [true, 'Anh ơi hôm nay phỏng vấn sao rồi'],
      [false, 'Trượt rồi em ạ, buồn quá']
    ]
  },
  {
    id: 'friend-tao-may-invite',
    context: { me: 'Khoa', them: 'Long', tags: ['Bạn bè'], closeFriend: true },
    expect: { intent: 'invite', self: 'tao', other: 'mày' },
    lines: [
      [true, 'Tao vừa đi làm về, mệt vãi'],
      [false, 'Mày rảnh không, tối nay đi nhậu không?']
    ]
  },
  {
    id: 'friend-tao-may-news',
    context: { me: 'Khoa', them: 'Long', tags: ['Bạn bè'], closeFriend: true },
    expect: { intent: 'good_news', self: 'tao', other: 'mày' },
    lines: [
      [true, 'Mày đâu rồi'],
      [false, 'Tao vừa được nhận vào công ty mới rồi nè, lương gấp đôi']
    ]
  },
  {
    id: 'friend-minh-ban-question',
    context: { me: 'Thảo', them: 'Vy', tags: ['Bạn bè'] },
    expect: { intent: 'question', self: 'mình', other: 'bạn' },
    lines: [
      [false, 'Mình gửi file thiết kế rồi nhé'],
      [true, 'Mình nhận được rồi, cảm ơn bạn'],
      [false, 'Bạn thấy màu xanh hay màu cam đẹp hơn?']
    ]
  },
  {
    id: 'friend-to-cau-apology',
    context: { me: 'Linh', them: 'Phương', tags: ['Bạn bè'] },
    expect: { intent: 'apology', self: 'tớ', other: 'cậu' },
    lines: [
      [true, 'Cậu tới chưa, tớ đợi ở quán rồi'],
      [false, 'Xin lỗi cậu nhé, tớ kẹt xe quá, 15 phút nữa tớ tới']
    ]
  },
  {
    id: 'boss-request',
    context: { me: 'Trang', them: 'Anh Quân', tags: ['Công việc'] },
    expect: { intent: 'request', self: 'em', other: 'anh' },
    lines: [
      [false, 'Trang ơi báo cáo tháng 9 xong chưa em'],
      [true, 'Dạ em đang làm, chiều nay em gửi anh ạ'],
      [false, 'Em gửi luôn file số liệu thô cho anh được không?']
    ]
  },
  {
    id: 'boss-meeting-question',
    context: { me: 'Trang', them: 'Chị Hoa', tags: ['Công việc'] },
    expect: { intent: 'question', self: 'em', other: 'chị' },
    lines: [
      [false, 'Mai họp lúc 9h nhé em'],
      [true, 'Dạ vâng chị'],
      [false, 'Em chuẩn bị slide xong chưa?']
    ]
  },
  {
    id: 'colleague-thanks',
    context: { me: 'Tuấn', them: 'Hà', tags: ['Công việc'] },
    expect: { intent: 'thanks', self: 'anh', other: 'em' },
    lines: [
      [false, 'Anh ơi em lỡ xoá file rồi, anh có bản sao không'],
      [true, 'Anh gửi lại cho em rồi đó'],
      [false, 'Em cảm ơn anh, anh cứu em một bàn thua trông thấy']
    ]
  },
  {
    id: 'lover-miss',
    context: { me: 'Huy', them: 'Ngọc', tags: ['Người yêu'] },
    expect: { intent: 'info', self: 'anh', other: 'em' },
    lines: [
      [true, 'Em ngủ chưa'],
      [false, 'Chưa anh, em đang nằm nghĩ linh tinh'],
      [false, 'Tự nhiên nhớ hồi mình đi Đà Lạt ghê']
    ]
  },
  {
    id: 'lover-good-news',
    context: { me: 'Ngọc', them: 'Huy', tags: ['Người yêu'] },
    expect: { intent: 'good_news', self: 'em', other: 'anh' },
    lines: [
      [true, 'Anh ơi hôm nay sao rồi'],
      [false, 'Em ơi anh được thăng chức rồi!!']
    ]
  },
  {
    id: 'teacher-parent',
    context: { me: 'Chị Thu', them: 'Cô Lan (GVCN)', tags: ['Trường học'] },
    expect: { intent: 'request', self: 'chị', other: 'cô' },
    lines: [
      [true, 'Cô ơi chị là mẹ bé An lớp 2A'],
      [false, 'Dạ chào chị'],
      [false, 'Chị nhớ ký giúp cô phiếu khảo sát gửi về hôm qua nhé']
    ]
  },
  {
    id: 'grandkid-greeting',
    context: { me: 'Bảo', them: 'Bà nội', tags: ['Gia đình'] },
    expect: { intent: 'greeting', self: 'cháu', other: 'bà' },
    lines: [
      [true, 'Cháu chào bà ạ, bà khoẻ không ạ'],
      [false, 'Chào cháu, bà khoẻ']
    ]
  },
  {
    id: 'landlord-question',
    context: { me: 'Đức', them: 'Chú Bình', tags: ['Nhà trọ'] },
    expect: { intent: 'question', self: 'cháu', other: 'chú' },
    lines: [
      [true, 'Chú ơi cháu chuyển tiền phòng tháng này rồi ạ'],
      [false, 'Ừ chú nhận rồi'],
      [false, 'Tháng sau cháu có ở tiếp không?']
    ]
  },
  {
    id: 'group-plan',
    context: { me: 'Khánh', them: 'Hội cấp 3', isGroup: true, tags: ['Bạn bè'] },
    expect: { intent: 'invite' },
    lines: [
      [false, 'Tết này họp lớp không mọi người'],
      [true, 'Đi chứ'],
      [false, 'Mùng 4 đi ăn ở quán cũ không?']
    ]
  },
  {
    id: 'stranger-greeting',
    context: { me: 'Minh Anh', them: 'Trần Văn Tài' },
    expect: { intent: 'greeting' },
    lines: [[false, 'Chào chị, em thấy chị bán sỉ áo thun trên nhóm']]
  },
  {
    id: 'friend-sad-breakup',
    context: { me: 'Vy', them: 'Thảo', tags: ['Bạn thân'], closeFriend: true },
    expect: { intent: 'bad_news', self: 'mình', other: 'bạn' },
    lines: [
      [true, 'Mình đi ăn trưa nha bạn'],
      [false, 'Mình với anh ấy chia tay rồi, mình buồn quá']
    ]
  },
  {
    id: 'delivery-info',
    context: { me: 'Minh Anh', them: 'Anh Shipper' },
    expect: { intent: 'info', self: 'em', other: 'anh' },
    lines: [
      [true, 'Anh ơi giao giúp em trước 5h nha'],
      [false, 'Anh tới đầu hẻm rồi em']
    ]
  },
  {
    id: 'cousin-wedding',
    context: { me: 'Tú', them: 'Chị Diệp', tags: ['Gia đình'] },
    expect: { intent: 'good_news', self: 'em', other: 'chị' },
    lines: [
      [true, 'Chị ơi dạo này chị sao rồi'],
      [false, 'Chị sắp cưới rồi em ơi, tháng 12 nha, em nhớ về đó']
    ]
  },
  {
    id: 'en-friend-invite',
    context: { me: 'Sam', them: 'Alex', tags: ['Friends'] },
    expect: { intent: 'invite' },
    lines: [
      [false, 'Long week huh'],
      [true, 'Tell me about it'],
      [false, "Let's grab dinner on Friday?"]
    ]
  },
  {
    id: 'en-colleague-question',
    context: { me: 'Sam', them: 'Jordan', tags: ['Work'] },
    expect: { intent: 'question' },
    lines: [
      [false, 'Hey, the client moved the call'],
      [true, 'Oh no, to when?'],
      [false, 'Can you still make it at 4pm tomorrow?']
    ]
  },
  {
    id: 'en-friend-good-news',
    context: { me: 'Sam', them: 'Priya', tags: ['Friends'] },
    expect: { intent: 'good_news' },
    lines: [
      [true, 'How did the exam go?'],
      [false, 'I passed!! Finally done with it']
    ]
  },
  {
    id: 'en-thanks',
    context: { me: 'Sam', them: 'Mia' },
    expect: { intent: 'thanks' },
    lines: [
      [true, 'Sent you the photos from Saturday'],
      [false, 'Thank you so much, they look amazing']
    ]
  },
  {
    id: 'customer-complaint',
    context: { me: 'Minh Anh', them: 'Chị Ngân', tags: ['Khách hàng'] },
    expect: { intent: 'info', self: 'em', other: 'chị' },
    lines: [
      [true, 'Dạ em gửi hàng cho chị rồi ạ'],
      [false, 'Hàng tới rồi mà áo bị lỗi đường may em ơi']
    ]
  },
  {
    id: 'aunt-question',
    context: { me: 'Hiếu', them: 'Dì Ba', tags: ['Gia đình'] },
    expect: { intent: 'question', self: 'con', other: 'dì' },
    lines: [
      [true, 'Dì ơi con gửi quà Trung thu cho dì rồi nha'],
      [false, 'Dì nhận rồi, con ở Sài Gòn có khoẻ không?']
    ]
  }
]
