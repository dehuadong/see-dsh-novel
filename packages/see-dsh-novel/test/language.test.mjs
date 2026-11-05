import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { projectionLanguage } from '../src/pipelines/long/language.ts'
import { defaultStateSnapshot, stateJsonWrites } from '../src/core/state.ts'
import { commitFoundation } from '../src/core/commit.ts'
import { writeWork } from '../src/core/work.ts'

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-language-'))
  await mkdir(join(root, 'source/story'), { recursive: true })
  return root
}

const cleanup = (root) => rm(root, { recursive: true, force: true })

test('projectionLanguage reads manifest first, then the work identity', async () => {
  const root = await workspace()
  try {
    assert.equal(await projectionLanguage(root), 'zh', '两样都没有时是中文')

    await writeWork(root, { title: '英文书', language: 'en' })
    assert.equal(await projectionLanguage(root), 'en')

    const snapshot = { ...defaultStateSnapshot([]), manifest: { ...defaultStateSnapshot([]).manifest, language: 'zh' } }
    await commitFoundation(root, { writes: stateJsonWrites(snapshot) })
    assert.equal(await projectionLanguage(root), 'zh', 'manifest 优先于作品身份')
  } finally {
    await cleanup(root)
  }
})

test('a corrupt work identity or manifest falls back to Chinese', async () => {
  const root = await workspace()
  try {
    await writeFile(join(root, 'work.json'), '{ not json', 'utf8')
    assert.equal(await projectionLanguage(root), 'zh')

    await mkdir(join(root, 'source/story/state'), { recursive: true })
    await writeFile(join(root, 'source/story/state/manifest.json'), '{"schemaVersion":2,"language":"en","lastAppliedChapter":0,"projectionVersion":1}', 'utf8')
    assert.equal(await projectionLanguage(root), 'en')

    await writeFile(join(root, 'source/story/state/manifest.json'), '{"schemaVersion":2', 'utf8')
    assert.equal(await projectionLanguage(root), 'zh', '坏的 manifest 退回作品身份，作品身份也坏就中文')
  } finally {
    await cleanup(root)
  }
})
