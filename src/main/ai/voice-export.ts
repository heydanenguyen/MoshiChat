/**
 * Export for a personal voice: the user's replies as training data, with the training tool beside them, in a
 * folder they pick. The tool copies its result to `installTo`, where the AI worker looks for it.
 */
import { chmod, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { ChatModel } from '@shared/ai'
import { voiceMessages } from '@shared/ai-prompts'
import type { TrainingSample } from '@shared/ai-style'
import readme from '../../../tools/voice-lora/README.txt?raw'
import runMac from '../../../tools/voice-lora/run-mac.command?raw'
import runWindows from '../../../tools/voice-lora/run-windows.cmd?raw'
import setupWindows from '../../../tools/voice-lora/setup-windows.ps1?raw'
import trainPy from '../../../tools/voice-lora/train.py?raw'

/** The full-precision models the GGUF files were made from: what a LoRA is trained on. */
export const VOICE_BASE: Record<ChatModel, string> = {
  'qwen35-0.8b': 'Qwen/Qwen3.5-0.8B',
  'qwen35-2b': 'Qwen/Qwen3.5-2B',
  'qwen35-4b': 'Qwen/Qwen3.5-4B',
  'qwen35-9b': 'Qwen/Qwen3.5-9B',
  'gemma4-12b': 'google/gemma-4-12B-it'
}

export async function exportVoiceTraining(folder: string, samples: TrainingSample[], model: ChatModel, installTo: string): Promise<{ folder: string; count: number }> {
  await mkdir(join(folder, 'data'), { recursive: true })
  const lines = samples.map((s) => JSON.stringify({ messages: [...voiceMessages(s.lines), { role: 'assistant', content: s.reply }] }))
  await writeFile(join(folder, 'data', 'train.jsonl'), lines.join('\n') + '\n', 'utf8')
  await writeFile(join(folder, 'meta.json'), JSON.stringify({ model, base: VOICE_BASE[model], count: samples.length, installTo, exportedAt: new Date().toISOString() }, null, 2), 'utf8')
  await writeFile(join(folder, 'train.py'), trainPy, 'utf8')
  await writeFile(join(folder, 'README.txt'), readme.replace(/\r?\n/g, process.platform === 'win32' ? '\r\n' : '\n'), 'utf8')
  // Windows scripts with CRLF; the Mac one with LF and executable
  await writeFile(join(folder, 'run-windows.cmd'), runWindows.replace(/\r?\n/g, '\r\n'), 'utf8')
  await writeFile(join(folder, 'setup-windows.ps1'), '﻿' + setupWindows.replace(/\r?\n/g, '\r\n'), 'utf8')
  await writeFile(join(folder, 'run-mac.command'), runMac.replace(/\r\n/g, '\n'), 'utf8')
  await chmod(join(folder, 'run-mac.command'), 0o755).catch(() => undefined)
  return { folder, count: samples.length }
}
