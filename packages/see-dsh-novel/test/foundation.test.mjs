import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, normalize } from 'node:path'

import { roleCardPath, sanitizeRoleName } from '../src/pipelines/long/contract.ts'
import { commitFoundation } from '../src/core/commit.ts'
import { installFoundationTools } from '../src/pipelines/long/tools.ts'

/** A throwaway work root plus the four tools bound to it. */
async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-'))
  const tools = new Map()
  const ctx = {
    tools: {
      register(definition) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
    workingDirectory: { ensure: async () => root },
  }
  const dispose = installFoundationTools(ctx)
  return { root, tools, dispose, exec: { agent: {} } }
}

/** @param {string} root @param {string} relativePath */
const read = (root, relativePath) => readFile(join(root, relativePath), 'utf8')

test('outline writes both outline documents', async () => {
  const { root, tools, dispose, exec } = await harness()
  try {
    const result = await tools.get('story_foundation_outline').execute(
      { storyFrame: '框架', volumeMap: '卷图' },
      exec,
    )
    assert.deepEqual([...result.written].sort(), [
      'source/story/author_intent.md',
      'source/story/current_focus.md',
      'source/story/outline/story_frame.md',
      'source/story/outline/volume_map.md',
    ].map(normalize).sort())
    assert.equal(await read(root, 'source/story/outline/story_frame.md'), '框架\n')
    assert.equal(await read(root, 'source/story/outline/volume_map.md'), '卷图\n')
  } finally {
    dispose()
  }
})

test('details writes book rules and seeds the four state files plus three projections', async () => {
  const { root, tools, dispose, exec } = await harness()
  try {
    await tools.get('story_foundation_details').execute({
      bookRules: '规则正文',
      bookRulesData: { prohibitions: ['不写现实政治'], enableFullCastTracking: false, allowedDeviations: [] },
      pendingHooks: [{ hookId: 'H1', type: '悬案', expectedPayoff: '首卷第三章', notes: '' }],
    }, exec)

    assert.equal(await read(root, 'source/story/book_rules.md'), '规则正文\n')
    assert.deepEqual(JSON.parse(await read(root, 'source/story/book_rules.json')), {
      version: '2',
      prohibitions: ['不写现实政治'],
      enableFullCastTracking: false,
      allowedDeviations: [],
    })
    assert.deepEqual(JSON.parse(await read(root, 'source/story/state/hooks.json')), {
      hooks: [{
        hookId: 'H1',
        startChapter: 0,
        type: '悬案',
        status: 'deferred',
        lastAdvancedChapter: 0,
        expectedPayoff: '首卷第三章',
        notes: '',
      }],
    })
    assert.deepEqual(JSON.parse(await read(root, 'source/story/state/manifest.json')), {
      schemaVersion: 2,
      language: 'zh',
      lastAppliedChapter: 0,
      projectionVersion: 1,
    })
    assert.deepEqual(JSON.parse(await read(root, 'source/story/state/current_state.json')), { chapter: 0, facts: [] })
    assert.deepEqual(JSON.parse(await read(root, 'source/story/state/chapter_summaries.json')), { rows: [] })

    // 三份投影与 JSON 同批落盘；伏笔投影带表头与这一行。
    assert.match(await read(root, 'source/story/pending_hooks.md'), /^# 伏笔池\n/)
    assert.match(await read(root, 'source/story/pending_hooks.md'), /\| H1 \| 0 \| 悬案 \|/)
    assert.match(await read(root, 'source/story/current_state.md'), /^# 当前状态\n/)
    assert.match(await read(root, 'source/story/chapter_summaries.md'), /^# 章节摘要\n/)
  } finally {
    dispose()
  }
})

test('invalid book rules are rejected before anything is written', async () => {
  const { root, tools, dispose, exec } = await harness()
  try {
    const details = tools.get('story_foundation_details')
    await assert.rejects(details.execute({
      bookRules: '规则',
      bookRulesData: { prohibitions: [] },
      pendingHooks: [],
    }, exec), /enableFullCastTracking/)
    assert.deepEqual(await readdir(join(root, 'source')).catch(() => []), [])
  } finally {
    dispose()
  }
})

test('a second details run does not overwrite existing state', async () => {
  const { root, tools, dispose, exec } = await harness()
  try {
    const details = tools.get('story_foundation_details')
    const args = {
      bookRules: '规则',
      bookRulesData: { prohibitions: [], enableFullCastTracking: false, allowedDeviations: [] },
      pendingHooks: [{ hookId: 'H1', type: '悬案', expectedPayoff: '首卷', notes: '' }],
    }
    await details.execute(args, exec)

    const advanced = { hooks: [{ hookId: 'H1', startChapter: 0, type: '悬案', status: 'resolved', lastAdvancedChapter: 9, expectedPayoff: '首卷', notes: '' }] }
    await writeFile(join(root, 'source/story/state/hooks.json'), JSON.stringify(advanced), 'utf8')

    await details.execute({ ...args, pendingHooks: [{ hookId: 'H2', type: '新钩子', expectedPayoff: '二卷', notes: '' }] }, exec)

    assert.deepEqual(JSON.parse(await read(root, 'source/story/state/hooks.json')), advanced)
  } finally {
    dispose()
  }
})

test('cast index rebuilds the card schema and cards land in tier directories', async () => {
  const { root, tools, dispose, exec } = await harness()
  try {
    const before = tools.get('story_foundation_cast_documents')
    const indexed = await tools.get('story_foundation_cast_index').execute({
      roles: [{ tier: 'major', name: '甲' }, { tier: 'minor', name: '乙/丙' }],
    }, exec)

    assert.deepEqual(indexed.roles, [{ tier: 'major', name: '甲' }, { tier: 'minor', name: '乙/丙' }])

    const cards = tools.get('story_foundation_cast_documents')
    assert.notEqual(cards, before)
    assert.deepEqual(Object.keys(cards.parameters.properties).sort(), ['mode', 'role_1_content', 'role_2_content'])

    await cards.execute({ role_1_content: '卡甲', role_2_content: '卡乙', mode: 'init' }, exec)
    assert.equal(await read(root, 'source/story/roles/主要角色/甲.md'), '卡甲\n')
    assert.equal(await read(root, 'source/story/roles/次要角色/乙_丙.md'), '卡乙\n')
  } finally {
    dispose()
  }
})

test('init keeps stale cards while revise deletes them', async () => {
  const { root, tools, dispose, exec } = await harness()
  try {
    const index = (roles) => tools.get('story_foundation_cast_index').execute({ roles }, exec)
    const cards = () => tools.get('story_foundation_cast_documents')

    await index([{ tier: 'minor', name: '乙' }])
    await cards().execute({ role_1_content: '卡乙', mode: 'init' }, exec)

    await index([{ tier: 'major', name: '甲' }])
    await cards().execute({ role_1_content: '卡甲', mode: 'init' }, exec)
    assert.equal(await read(root, 'source/story/roles/次要角色/乙.md'), '卡乙\n')

    const result = await cards().execute({ role_1_content: '卡甲二版', mode: 'revise' }, exec)
    assert.deepEqual(result.deleted, [normalize('source/story/roles/次要角色/乙.md')])
    assert.equal(await read(root, 'source/story/roles/主要角色/甲.md'), '卡甲二版\n')
    await assert.rejects(read(root, 'source/story/roles/次要角色/乙.md'))
  } finally {
    dispose()
  }
})

test('a failed commit restores what it had already written', async () => {
  const { root, tools, dispose, exec } = await harness()
  try {
    const outline = tools.get('story_foundation_outline')
    await outline.execute({ storyFrame: '第一版', volumeMap: '第一卷图' }, exec)

    // 第二个目标的父路径是一个文件：mkdir 失败，整批回滚。
    await writeFile(join(root, 'source/story/outline/blocker'), 'x', 'utf8')
    await assert.rejects(commitFoundation(root, {
      writes: [
        { relativePath: 'source/story/outline/story_frame.md', content: '第二版\n' },
        { relativePath: 'source/story/outline/blocker/child.md', content: 'y' },
      ],
    }))
    assert.equal(await read(root, 'source/story/outline/story_frame.md'), '第一版\n')
    assert.equal(await read(root, 'source/story/outline/blocker'), 'x')
  } finally {
    dispose()
  }
})

test('role names are sanitized and empty names are rejected', () => {
  assert.equal(sanitizeRoleName(' 阿/毛 '), '阿_毛')
  assert.equal(roleCardPath('major', 'a:b'), 'source/story/roles/主要角色/a_b.md')
  assert.equal(roleCardPath('minor', '丙'), 'source/story/roles/次要角色/丙.md')
  assert.throws(() => sanitizeRoleName('   '), /无法表示为安全的文件名/)
  assert.throws(() => roleCardPath('guest', '丁'), /未知角色级别/)
})
