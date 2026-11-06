import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { normalizeTruthFileName, truthFileRelativePath } from '../src/core/truth-files.ts'
import { installTruthFileTool } from '../src/pipelines/long/truth-tool.ts'

async function workspace() {
  return mkdtemp(join(tmpdir(), 'see-dsh-novel-truth-'))
}

const cleanup = (root) => rm(root, { recursive: true, force: true })

function services(root) {
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
  installTruthFileTool(ctx)
  return {
    tools,
    ctx,
    exec: { agent: {} },
    run: (args) => tools.get('story_truth_file').execute(args, { agent: {} }),
  }
}

const text = (root, relative) => readFile(join(root, relative), 'utf8')

test('names are canonicalized inside the allowlist and rejected outside it', () => {
  assert.equal(normalizeTruthFileName('Author_Intent'), 'author_intent.md')
  assert.equal(normalizeTruthFileName(' outline/story_frame '), 'outline/story_frame.md')
  assert.equal(normalizeTruthFileName('roles/主要角色/甲'), 'roles/主要角色/甲.md')
  assert.equal(normalizeTruthFileName('roles/major/A.md'), 'roles/major/A.md')
  assert.equal(truthFileRelativePath('outline/story_frame.md'), 'source/story/outline/story_frame.md')

  assert.throws(() => normalizeTruthFileName('chapters/1.md'), /不在白名单/)
  assert.throws(() => normalizeTruthFileName('../book_rules.md'), /\.\./)
  assert.throws(() => normalizeTruthFileName('/author_intent.md'), /绝对路径/)
  assert.throws(() => normalizeTruthFileName('roles/支线角色/甲.md'), /不在白名单/)
  assert.throws(() => normalizeTruthFileName('  '), /不能为空/)
})

test('a direction document is written verbatim and the sibling default is seeded once', async () => {
  const root = await workspace()
  try {
    const { run } = services(root)
    const result = await run({ fileName: 'Author_Intent.md', content: '  新方向\n第二行  ' })
    assert.equal(result.fileName, 'author_intent.md')
    assert.deepEqual(result.written.sort(), ['source/story/author_intent.md', 'source/story/current_focus.md'])
    assert.equal(await text(root, 'source/story/author_intent.md'), '  新方向\n第二行  ')
    assert.match(await text(root, 'source/story/current_focus.md'), /^# 当前聚焦/)
    assert.equal(JSON.stringify(result).includes('author_intent.md'), true)
  } finally {
    await cleanup(root)
  }
})

test('an empty content is allowed and an unknown name writes nothing', async () => {
  const root = await workspace()
  try {
    const { run } = services(root)
    await run({ fileName: 'current_focus', content: '' })
    assert.equal(await text(root, 'source/story/current_focus.md'), '')
    await assert.rejects(run({ fileName: 'nope.md', content: 'x' }), /不在白名单/)
    await assert.rejects(run({ fileName: 'roles/其他/甲.md', content: 'x' }), /不在白名单/)
  } finally {
    await cleanup(root)
  }
})

test('book rules need structured data and rewrite both files with version 2', async () => {
  const root = await workspace()
  try {
    const { run } = services(root)
    await assert.rejects(run({ fileName: 'book_rules.md', content: '# 规则' }), /bookRulesData/)
    assert.equal(await text(root, 'source/story/book_rules.md').catch(() => 'missing'), 'missing')

    await run({
      fileName: 'book_rules.md',
      content: '# 规则\n',
      bookRulesData: { prohibitions: ['不写现实政治'], enableFullCastTracking: false, allowedDeviations: [] },
    })
    assert.equal(await text(root, 'source/story/book_rules.md'), '# 规则\n')
    assert.deepEqual(JSON.parse(await text(root, 'source/story/book_rules.json')), {
      version: '2',
      prohibitions: ['不写现实政治'],
      enableFullCastTracking: false,
      allowedDeviations: [],
    })

    await assert.rejects(run({ fileName: 'book_rules.md', content: 'x', bookRulesData: { prohibitions: [] } }), /enableFullCastTracking/)
    assert.equal(await text(root, 'source/story/book_rules.md'), '# 规则\n', '非法数据不改写已有文件')
    assert.deepEqual(JSON.parse(await text(root, 'source/story/book_rules.json')).version, '2')
  } finally {
    await cleanup(root)
  }
})

test('role cards and outline files are written at their own paths', async () => {
  const root = await workspace()
  try {
    const { run, tools } = services(root)
    const role = await run({ fileName: 'roles/主要角色/甲.md', content: '# 甲\n' })
    assert.deepEqual(role.written.sort(), ['source/story/author_intent.md', 'source/story/current_focus.md', 'source/story/roles/主要角色/甲.md'])
    assert.equal(await text(root, 'source/story/roles/主要角色/甲.md'), '# 甲\n')

    const minor = await run({ fileName: 'roles/minor/乙.md', content: '# 乙\n' })
    assert.equal(await text(root, 'source/story/roles/minor/乙.md'), '# 乙\n')
    assert.equal(minor.written.includes('source/story/roles/minor/乙.md'), true)

    const outline = await run({ fileName: 'outline/volume_map.md', content: '# 卷图\n' })
    assert.deepEqual(outline.written, ['source/story/outline/volume_map.md'])
    assert.equal(await text(root, 'source/story/outline/volume_map.md'), '# 卷图\n')

    // 每个平铺名字都能写：写一次，读回内容。
    for (const name of ['style_guide', 'parent_canon', 'fanfic_canon', 'current_state', 'pending_hooks', 'chapter_summaries']) {
      await run({ fileName: name, content: `# ${name}\n` })
      assert.equal(await text(root, `source/story/${name}.md`), `# ${name}\n`)
    }

    // 渲染是单行 Updated，不带额外路径行。
    const rendered = tools.get('story_truth_file').output.render({}, outline)[0].text
    assert.equal(rendered, 'Updated "outline/volume_map.md"')
  } finally {
    await cleanup(root)
  }
})
