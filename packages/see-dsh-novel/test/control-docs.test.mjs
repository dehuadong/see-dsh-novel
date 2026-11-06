import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  defaultAuthorIntent,
  defaultCurrentFocus,
  ensureControlDocuments,
  readControlDocs,
} from '../src/core/control-docs.ts'
import { createWork } from '../src/core/work.ts'
import { installFoundationTools } from '../src/pipelines/long/tools.ts'
import { AUTHOR_INTENT_FILE, BRIEF_FILE, CURRENT_FOCUS_FILE } from '../src/core/story-paths.ts'

async function workspace() {
  return mkdtemp(join(tmpdir(), 'see-dsh-novel-control-'))
}

const cleanup = (root) => rm(root, { recursive: true, force: true })

/** 一个只注册 foundation 工具的假 ctx。 */
function services(root) {
  const tools = new Map()
  return {
    tools,
    ctx: {
      tools: {
        register(definition) {
          tools.set(definition.name, definition)
          return () => tools.delete(definition.name)
        },
      },
      workingDirectory: { ensure: async () => root },
    },
    exec: { agent: {} },
  }
}

test('createWork stores the intent verbatim and writes the brief in the same commit', async () => {
  const root = await workspace()
  try {
    const intent = '  第一行\n第二行  '
    const work = await createWork(root, { title: '原文', intent }, [{ relativePath: BRIEF_FILE, content: intent }])
    assert.equal(work.metadata.intent, intent)
    assert.equal(await readFile(join(root, BRIEF_FILE), 'utf8'), intent)
  } finally {
    await cleanup(root)
  }
})

test('ensureControlDocuments only fills what is missing', async () => {
  const root = await workspace()
  try {
    const first = await ensureControlDocuments(root, 'zh')
    assert.deepEqual(first.map((write) => write.relativePath).sort(), [AUTHOR_INTENT_FILE, CURRENT_FOCUS_FILE])
    assert.equal(first.find((write) => write.relativePath === AUTHOR_INTENT_FILE)?.content, defaultAuthorIntent('zh'))
    assert.equal(first.find((write) => write.relativePath === CURRENT_FOCUS_FILE)?.content, defaultCurrentFocus('zh'))

    const { commitFoundation } = await import('../src/core/commit.ts')
    await commitFoundation(root, { writes: first })
    assert.deepEqual(await ensureControlDocuments(root, 'en'), [], '已有文件不再生成写入项')

    await writeFile(join(root, AUTHOR_INTENT_FILE), '# 我自己的方向\n', 'utf8')
    assert.deepEqual((await readControlDocs(root)).authorIntent, '# 我自己的方向\n')
  } finally {
    await cleanup(root)
  }
})

test('readControlDocs returns empty for a missing brief but keeps the direction docs', async () => {
  const root = await workspace()
  try {
    const docs = await readControlDocs(root, 'zh')
    assert.equal(docs.brief, '')
    assert.equal(docs.authorIntent, defaultAuthorIntent('zh'))
    assert.equal(docs.currentFocus, defaultCurrentFocus('zh'))
    assert.equal(await readFile(join(root, BRIEF_FILE), 'utf8').catch(() => 'missing'), 'missing')
  } finally {
    await cleanup(root)
  }
})

test('story_foundation_details seeds both direction documents on the first truth write', async () => {
  const root = await workspace()
  try {
    const { tools, ctx, exec } = services(root)
    const dispose = installFoundationTools(ctx)
    await tools.get('story_foundation_details').execute({
      bookRules: '规则',
      bookRulesData: { prohibitions: [], enableFullCastTracking: false, allowedDeviations: [] },
      pendingHooks: [],
    }, exec)
    assert.equal(await readFile(join(root, AUTHOR_INTENT_FILE), 'utf8'), defaultAuthorIntent('zh'))
    assert.equal(await readFile(join(root, CURRENT_FOCUS_FILE), 'utf8'), defaultCurrentFocus('zh'))
    dispose()
  } finally {
    await cleanup(root)
  }
})
