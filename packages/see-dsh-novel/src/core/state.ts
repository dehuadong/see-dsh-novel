/**
 * 状态文件播种。
 *
 * 只在文件不存在时写入：后续能力会往这些文件里推进章节与事实，
 * 重跑 foundation 不得覆盖它们。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { FileWrite } from './commit.js'
import type { PendingHook } from './types.js'

const STATE_DIR = 'source/story/state'

interface HookRecord {
  hookId: string
  startChapter: number
  type: string
  status: 'deferred'
  lastAdvancedChapter: number
  expectedPayoff: string
  notes: string
}

function hookRecord(hook: PendingHook): HookRecord {
  return {
    hookId: String(hook.hookId).trim(),
    startChapter: 0,
    type: String(hook.type).trim(),
    status: 'deferred',
    lastAdvancedChapter: 0,
    expectedPayoff: String(hook.expectedPayoff).trim(),
    notes: String(hook.notes ?? '').trim(),
  }
}

async function missing(path: string): Promise<boolean> {
  try {
    await readFile(path)
    return false
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true
    throw error
  }
}

/** 状态文件的默认内容；索引（前三项之外的 hooks 也在此）由 foundation 与自检共用。 */
export function defaultStateFiles(hooks: ReadonlyArray<PendingHook>): FileWrite[] {
  const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`
  const candidates: Array<[string, unknown]> = [
    ['manifest.json', { schemaVersion: 2, language: 'zh', lastAppliedChapter: 0, projectionVersion: 1 }],
    ['current_state.json', { chapter: 0, facts: [] }],
    ['hooks.json', { hooks: hooks.map(hookRecord) }],
    ['chapter_summaries.json', { rows: [] }],
  ]
  return candidates.map(([name, value]) => ({ relativePath: `${STATE_DIR}/${name}`, content: json(value) }))
}

/** 生成「尚不存在」的状态文件写入项，交给同一次 commit 原子落盘。 */
export async function stateWritesIfMissing(
  root: string,
  hooks: ReadonlyArray<PendingHook>,
): Promise<FileWrite[]> {
  const writes: FileWrite[] = []
  for (const write of defaultStateFiles(hooks)) {
    const name = write.relativePath.slice(STATE_DIR.length + 1)
    if (await missing(join(root, STATE_DIR, name))) writes.push(write)
  }
  return writes
}
