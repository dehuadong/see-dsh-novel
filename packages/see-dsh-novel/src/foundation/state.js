/**
 * 状态文件播种。
 *
 * 只在文件不存在时写入：后续能力会往这些文件里推进章节与事实，
 * 重跑 foundation 不得覆盖它们。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const STATE_DIR = 'source/story/state'

/** @param {unknown} hook */
function hookRecord(hook) {
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

/** @param {string} path */
async function missing(path) {
  try {
    await readFile(path)
    return false
  } catch (error) {
    if (error.code === 'ENOENT') return true
    throw error
  }
}

/**
 * 生成「尚不存在」的状态文件写入项，交给同一次 commit 原子落盘。
 * @param {string} root
 * @param {ReadonlyArray<unknown>} hooks
 * @returns {Promise<Array<{ relativePath: string, content: string }>>}
 */
export async function stateWritesIfMissing(root, hooks) {
  const json = (value) => `${JSON.stringify(value, null, 2)}\n`
  const candidates = [
    ['manifest.json', { schemaVersion: 2, language: 'zh', lastAppliedChapter: 0, projectionVersion: 1 }],
    ['current_state.json', { chapter: 0, facts: [] }],
    ['hooks.json', { hooks: hooks.map(hookRecord) }],
    ['chapter_summaries.json', { rows: [] }],
  ]

  const writes = []
  for (const [name, value] of candidates) {
    if (await missing(join(root, STATE_DIR, name))) {
      writes.push({ relativePath: `${STATE_DIR}/${name}`, content: json(value) })
    }
  }
  return writes
}
