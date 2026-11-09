import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { INDEX_PATH, rebuildStoryIndex, searchStory, splitMarkdownSections } from '../src/core/story-index.ts'

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-index-'))
  await mkdir(join(root, 'source/story/state'), { recursive: true })
  await mkdir(join(root, 'source/story/outline'), { recursive: true })
  await mkdir(join(root, 'source/story/roles/主要角色'), { recursive: true })
  await mkdir(join(root, 'source/story/materials'), { recursive: true })
  await writeFile(join(root, 'work.json'), JSON.stringify({
    version: 1, id: 'w1', title: '索引', profile: 'longform-novel', language: 'zh', status: 'draft',
    metadata: {}, createdAt: '2026-11-06T00:00:00.000Z', updatedAt: '2026-11-06T00:00:00.000Z',
  }, null, 2) + '\n')
  await writeFile(join(root, 'source/story/state/hooks.json'), JSON.stringify({
    hooks: [
      { hookId: 'H1', startChapter: 0, type: '悬案', status: 'deferred', lastAdvancedChapter: 0, expectedPayoff: '首卷回收', notes: '开场埋' },
      { hookId: 'H2', startChapter: 0, type: '已解', status: 'resolved', lastAdvancedChapter: 1, expectedPayoff: '已回收', notes: '不再检索' },
    ],
  }, null, 2) + '\n')
  await writeFile(join(root, 'source/story/state/chapter_summaries.json'), JSON.stringify({
    rows: [{
      chapter: 1,
      title: '雨夜',
      characters: '甲',
      events: '主角发现身份线索',
      stateChanges: '身份动摇',
      hookActivity: 'H1 推进',
      mood: '压抑',
      chapterType: '推进',
    }],
  }, null, 2) + '\n')
  await writeFile(join(root, 'source/story/volume_summaries.md'), '## 第一卷\n\n卷摘要：雨夜里的身份线。\n')
  await writeFile(join(root, 'source/story/roles/主要角色/甲.md'), '# 甲\n\n雾津的修表匠。\n')
  await writeFile(join(root, 'source/story/materials/素材.md'), '# 素材\n\n修表铺的账本。\n')
  await writeFile(join(root, 'source/story/outline/story_frame.md'), '# 框架\n\n## 前提\n\n一桩悬案。\n\n## 冲突\n\n身份与记忆。\n')
  return root
}

const cleanup = (root) => rm(root, { recursive: true, force: true })

test('splitMarkdownSections splits on level-2 headings', () => {
  const sections = splitMarkdownSections('# 标题\n\n## 前提\n正文一\n## 冲突\n正文二\n')
  assert.deepEqual(sections.map((section) => section.heading), ['前提', '冲突'])
  assert.equal(sections[1].body, '正文二')
})

test('rebuild indexes the story memory kinds and the transitional candidates', async () => {
  const root = await workspace()
  try {
    const result = await rebuildStoryIndex(root)
    assert.equal(result.scope, 'story-memory')
    assert.equal((await stat(join(root, INDEX_PATH))).isFile(), true)

    const hooks = await searchStory(root, '悬案', { kinds: ['hook'] })
    assert.equal(hooks.length, 1)
    assert.equal(hooks[0].source, 'source/story/pending_hooks.md#H1')
    assert.deepEqual(hooks[0].metadata, { hookId: 'H1' })
    assert.deepEqual(await searchStory(root, '已解', { kinds: ['hook'] }), [], 'resolved hook 不索引')

    const summaries = await searchStory(root, '身份线索', { kinds: ['chapter-summary'] })
    assert.equal(summaries[0].title, '雨夜')
    assert.deepEqual(summaries[0].metadata, { chapter: 1 })
    for (const part of ['甲', '主角发现身份线索', '身份动摇', 'H1 推进', '压抑', '推进']) {
      assert.match(summaries[0].body, new RegExp(part), `summary body 含 ${part}`)
    }

    const volumes = await searchStory(root, '卷摘要', { kinds: ['volume-summary'] })
    assert.equal(volumes[0].source, 'source/story/volume_summaries.md#第一卷')

    const roles = await searchStory(root, '修表匠', { kinds: ['role'] })
    assert.equal(roles[0].source, 'source/story/roles/主要角色/甲.md')
    const materials = await searchStory(root, '账本', { kinds: ['material'] })
    assert.equal(materials[0].source, 'source/story/materials/素材.md')
    const outline = await searchStory(root, '记忆', { kinds: ['outline'] })
    assert.equal(outline.length, 1)
  } finally {
    await cleanup(root)
  }
})

test('deleting a role removes it from the index on rebuild', async () => {
  const root = await workspace()
  try {
    await rebuildStoryIndex(root)
    assert.equal((await searchStory(root, '修表匠', { kinds: ['role'] })).length, 1)
    await rm(join(root, 'source/story/roles/主要角色/甲.md'))
    await rebuildStoryIndex(root)
    assert.deepEqual(await searchStory(root, '修表匠', { kinds: ['role'] }), [])
  } finally {
    await cleanup(root)
  }
})
