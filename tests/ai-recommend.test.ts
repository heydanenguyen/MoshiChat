import { describe, expect, it } from 'vitest'
import { chatModelOf, recommendChatModels, type Hardware } from '../src/shared/ai'

const pc = (h: Partial<Hardware>): Hardware => ({ gpu: false, vramGb: 0, ramGb: 16, unified: false, ...h })

describe('recommendChatModels', () => {
  it('a GPU with room picks the largest model that fits, then the next size down', () => {
    expect(recommendChatModels(pc({ gpu: 'vulkan', vramGb: 11, ramGb: 64 }))).toEqual({ picks: ['gemma4-12b', 'qwen35-9b'], on: 'gpu' })
    expect(recommendChatModels(pc({ gpu: 'vulkan', vramGb: 8, ramGb: 32 }))).toEqual({ picks: ['qwen35-9b', 'qwen35-4b'], on: 'gpu' })
    expect(recommendChatModels(pc({ gpu: 'vulkan', vramGb: 6, ramGb: 16 }))).toEqual({ picks: ['qwen35-4b', 'qwen35-2b'], on: 'gpu' })
    expect(recommendChatModels(pc({ gpu: 'cuda', vramGb: 4, ramGb: 16 })).picks).toEqual(['qwen35-2b', 'qwen35-0.8b'])
  })

  it('an Apple chip shares memory: 16 GB runs 12B, 12 GB runs 9B, 8 GB runs 4B', () => {
    expect(recommendChatModels(pc({ gpu: 'metal', vramGb: 12, ramGb: 16, unified: true })).picks[0]).toBe('gemma4-12b')
    expect(recommendChatModels(pc({ gpu: 'metal', vramGb: 9, ramGb: 12, unified: true })).picks[0]).toBe('qwen35-9b')
    expect(recommendChatModels(pc({ gpu: 'metal', vramGb: 5.3, ramGb: 8, unified: true })).picks[0]).toBe('qwen35-4b')
  })

  it('without a usable GPU, the CPU decides by RAM', () => {
    expect(recommendChatModels(pc({ ramGb: 32 }))).toEqual({ picks: ['qwen35-4b', 'qwen35-2b'], on: 'cpu' })
    expect(recommendChatModels(pc({ ramGb: 8 }))).toEqual({ picks: ['qwen35-2b', 'qwen35-0.8b'], on: 'cpu' })
    expect(recommendChatModels(pc({ ramGb: 4 }))).toEqual({ picks: ['qwen35-0.8b', 'qwen35-2b'], on: 'cpu' })
    // a GPU too small for even 2B falls back to the CPU
    expect(recommendChatModels(pc({ gpu: 'vulkan', vramGb: 1, ramGb: 16 })).on).toBe('cpu')
  })
})

describe('chatModelOf', () => {
  it('keeps a known model and maps the old settings', () => {
    expect(chatModelOf('qwen35-9b')).toBe('qwen35-9b')
    expect(chatModelOf('gemma4-12b')).toBe('gemma4-12b')
    expect(chatModelOf('better')).toBe('qwen35-4b')
    expect(chatModelOf('small')).toBe('qwen35-2b')
    expect(chatModelOf(undefined)).toBe('qwen35-2b')
  })
})
