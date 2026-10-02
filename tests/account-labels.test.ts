import { describe, expect, it, vi } from 'vitest'
import type { Account } from '../src/shared/types'

vi.mock('../src/renderer/src/store', () => ({ useStore: () => ({}) }))
const { accountLabels } = await import('../src/renderer/src/accountLabels')

const account = (id: string, platform: Account['platform'], displayName: string, handle?: string, demo?: boolean): Account =>
  ({ id, platform, displayName, handle, demo, status: 'connected', features: { reply: true, react: true, attachments: true, unsend: true } }) as Account

describe('account labels', () => {
  it('names accounts only on apps with more than one, by @handle or else by name', () => {
    const labels = accountLabels([
      account('instagram:ig-1', 'instagram', 'Dane Nguyen', '@seemenowhere'),
      account('instagram:ig-2', 'instagram', 'dane.log', '@dane.log'),
      account('messenger:fb-1', 'messenger', 'Dane Nguyen', 'fb.com/dane.nguyenn'),
      account('messenger:fb-2', 'messenger', 'Nguyễn Anh Đức', 'fb.com/dane.smnw'),
      account('zalo:1', 'zalo', 'Dane Nguyễn', '@t_m7ez0ic9ee'),
      // A sample account never makes a real one need a label.
      account('telegram:1', 'telegram', 'Dane', '@dane'),
      account('telegram:demo', 'telegram', 'Demo', '@demo', true)
    ])
    expect(labels).toEqual({
      'instagram:ig-1': '@seemenowhere',
      'instagram:ig-2': '@dane.log',
      'messenger:fb-1': 'Dane Nguyen',
      'messenger:fb-2': 'Nguyễn Anh Đức'
    })
  })
})
