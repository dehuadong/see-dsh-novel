import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { commitFile } from '../src/core/commit.ts'
import {
  STORY_FRAME_FILE,
  STORY_STATE_FILE,
  WORK_FILE,
  parseWork,
  readWork,
  workProbes,
  writeWork,
} from '../src/core/work.ts'
import { NEXT_STEPS, PHASES, storyNext, storyNextOutput, storyNextParameters } from '../src/plugin/story-next.ts'
import {
  WORK_CREATE_NAME,
  WORK_SHOW_NAME,
  installWorkTools,
  workCreateOutput,
  workCreateParameters,
  workShowOutput,
} from '../src/plugin/work-tools.ts'
import { violations } from './support/schema-subset.mjs'

/** 一个空的临时工作区。 */
async function workspace() {
  return mkdtemp(join(tmpdir(), 'see-dsh-novel-work-'))
}

const cleanup = (root) => rm(root, { recursive: true, force: true })

/** 一个只带 `workingDirectory` 的假 ctx；工具执行壳从这里解析作品根。 */
function services(root) {
  const registered = new Map()
  return {
    registered,
    ctx: {
      tools: {
        register(definition) {
          registered.set(definition.name, definition)
          return () => registered.delete(definition.name)
        },
      },
      workingDirectory: { ensure: async () => root, get: () => root },
    },
  }
}

/** 工具执行上下文：作品工具要求有归属 agent。 */
const exec = { agent: { session: { snapshotEvents: () => [] } } }

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

test('create writes a complete identity file', async () => {
  const root = await workspace()
  try {
    const work = await writeWork(root, { title: '我的小说', targetChapters: 120, chapterWordCount: 3000 })
    assert.equal(work.version, 1)
    assert.equal(work.id, basename(root))
    assert.equal(work.title, '我的小说')
    assert.equal(work.profile, 'longform-novel')
    assert.equal(work.language, 'zh')
    assert.equal(work.status, 'draft')
    assert.deepEqual(work.metadata, { targetChapters: 120, chapterWordCount: 3000 })
    assert.equal(Number.isNaN(Date.parse(work.createdAt)), false)
    assert.equal(work.createdAt, work.updatedAt)

    const onDisk = JSON.parse(await readFile(join(root, WORK_FILE), 'utf8'))
    assert.deepEqual(onDisk, work)
    assert.deepEqual(await readWork(root), work)

    // 第二次立项不覆盖：内容与报错都要可核对。
    const before = await readFile(join(root, WORK_FILE), 'utf8')
    await assert.rejects(writeWork(root, { title: '另一个名字' }), /已经存在/)
    assert.equal(await readFile(join(root, WORK_FILE), 'utf8'), before)
  } finally {
    await cleanup(root)
  }
})

test('create rejects invalid input without writing anything', async () => {
  const root = await workspace()
  try {
    await assert.rejects(writeWork(root, { title: '   ' }), /title/)
    await assert.rejects(writeWork(root, { title: 'x', language: 'fr' }), /language/)
    await assert.rejects(writeWork(root, { title: 'x', targetChapters: 0 }), /targetChapters/)
    await assert.rejects(writeWork(root, { title: 'x', chapterWordCount: -3 }), /chapterWordCount/)
    await assert.rejects(writeWork(root, { title: 'x', targetChapters: 1.5 }), /targetChapters/)
    assert.equal(await exists(join(root, WORK_FILE)), false)

    // 语言可省，默认中文；两个规模字段都可省，metadata 落成空对象。
    const work = await writeWork(root, { title: '无规模' })
    assert.equal(work.language, 'zh')
    assert.deepEqual(work.metadata, {})
  } finally {
    await cleanup(root)
  }
})

test('parseWork is strict about fields, version and types', async () => {
  const valid = {
    version: 1,
    id: 'demo',
    title: '演示',
    profile: 'longform-novel',
    language: 'zh',
    status: 'draft',
    metadata: {},
    createdAt: '2026-11-05T00:00:00.000Z',
    updatedAt: '2026-11-05T00:00:00.000Z',
  }
  assert.deepEqual(parseWork(valid, 'work.json'), { ...valid, metadata: {} })

  const cases = [
    [{ ...valid, extra: 1 }, /未知字段 "extra"/],
    [{ ...valid, version: 2 }, /version/],
    [{ ...valid, language: 'fr' }, /language/],
    [{ ...valid, status: 'doing' }, /status/],
    [{ ...valid, profile: 'short-story' }, /profile/],
    [{ ...valid, metadata: { targetChapters: '12' } }, /metadata.targetChapters/],
    [{ ...valid, metadata: { unknown: 1 } }, /未知字段 "unknown"/],
    [{ ...valid, metadata: {} , title: '' }, /title/],
    [{ ...valid, createdAt: 'yesterday' }, /createdAt/],
    [[], /必须是对象/],
    [{ ...valid, metadata: [] }, /metadata 必须是对象/],
  ]
  for (const [value, pattern] of cases) {
    assert.throws(() => parseWork(value, 'work.json'), pattern)
    assert.throws(() => parseWork(value, 'work.json'), /work\.json: /)
  }
})

test('readWork returns null when absent and fails loudly when broken', async () => {
  const root = await workspace()
  try {
    assert.equal(await readWork(root), null)

    await writeFile(join(root, WORK_FILE), '{ not json', 'utf8')
    await assert.rejects(readWork(root), /不是合法 JSON/)

    await writeFile(join(root, WORK_FILE), JSON.stringify({ version: 1 }), 'utf8')
    await assert.rejects(readWork(root), /work\.json: /)
    await assert.rejects(readWork(root), /未知字段|必须/ )
  } finally {
    await cleanup(root)
  }
})

test('the probes only look at existence', async () => {
  const root = await workspace()
  try {
    assert.deepEqual(await workProbes(root), { hasWork: false, hasFrame: false, hasState: false })

    await writeWork(root, { title: '探针' })
    assert.deepEqual(await workProbes(root), { hasWork: true, hasFrame: false, hasState: false })

    await mkdir(join(root, 'source/story/outline'), { recursive: true })
    await writeFile(join(root, STORY_FRAME_FILE), '# 大纲\n', 'utf8')
    assert.deepEqual(await workProbes(root), { hasWork: true, hasFrame: true, hasState: false })

    await mkdir(join(root, 'source/story/state'), { recursive: true })
    await writeFile(join(root, STORY_STATE_FILE), '{}\n', 'utf8')
    assert.deepEqual(await workProbes(root), { hasWork: true, hasFrame: true, hasState: true })
  } finally {
    await cleanup(root)
  }
})

test('storyNext reports four phases in order', () => {
  const none = { hasWork: false, hasFrame: false, hasState: false, title: null }
  assert.deepEqual(storyNext(none), { work: null, phase: 'unbound', next: NEXT_STEPS.unbound })

  // 身份在、设定没写：foundation。
  assert.deepEqual(
    storyNext({ ...none, hasWork: true, title: '有身份' }),
    { work: '有身份', phase: 'foundation', next: NEXT_STEPS.foundation },
  )
  // 状态清单先于大纲出现（details 段允许）：仍算 foundation，不是 unbound。
  assert.deepEqual(
    storyNext({ ...none, hasState: true }),
    { work: null, phase: 'foundation', next: NEXT_STEPS.foundation },
  )
  // 大纲在、状态清单缺：draft。
  assert.deepEqual(
    storyNext({ ...none, hasFrame: true }),
    { work: null, phase: 'draft', next: NEXT_STEPS.draft },
  )
  // 内容齐、身份缺：ready 且 work 为 null。
  assert.deepEqual(
    storyNext({ ...none, hasFrame: true, hasState: true }),
    { work: null, phase: 'ready', next: NEXT_STEPS.ready },
  )
  // 三样齐全：ready 且带标题。
  assert.deepEqual(
    storyNext({ hasWork: true, hasFrame: true, hasState: true, title: '全' }),
    { work: '全', phase: 'ready', next: NEXT_STEPS.ready },
  )
  assert.equal(PHASES.length, 4)
  assert.deepEqual(new Set(Object.values(NEXT_STEPS)).size, 4)
})

test('commitFile writes one file and leaves no temporary residue', async () => {
  const root = await workspace()
  try {
    await commitFile(root, 'work.json', '{"ok":true}\n')
    assert.equal(await readFile(join(root, WORK_FILE), 'utf8'), '{"ok":true}\n')
    assert.deepEqual(await readdir(root), [WORK_FILE])

    // 目标目录被同名文件占住：写入失败，临时文件不留。
    await writeFile(join(root, 'blocked'), 'x', 'utf8')
    await assert.rejects(commitFile(root, 'blocked/inner.json', 'x'))
    assert.deepEqual((await readdir(root)).sort(), ['blocked', WORK_FILE].sort())
  } finally {
    await cleanup(root)
  }
})

test('the work tools create, show and refuse to overwrite', async () => {
  const root = await workspace()
  try {
    const { registered, ctx } = services(root)
    const dispose = installWorkTools(ctx)
    assert.deepEqual([...registered.keys()].sort(), [WORK_CREATE_NAME, WORK_SHOW_NAME])

    const create = registered.get(WORK_CREATE_NAME)
    const show = registered.get(WORK_SHOW_NAME)
    assert.equal((await show.execute({}, exec)).work, null)

    const created = await create.execute({ title: '工具立项', language: 'en', metadata: { targetChapters: 20 } }, exec)
    assert.equal(created.work.title, '工具立项')
    assert.equal(created.work.language, 'en')
    assert.equal(created.work.metadata.targetChapters, 20)

    const shown = await show.execute({}, exec)
    assert.deepEqual(shown.work, created.work)

    await assert.rejects(create.execute({ title: '再来一次' }, exec), /已经存在/)

    // 渲染是内容块数组，运行时会对它调用 `.some`。
    for (const [definition, value] of [[create, created], [show, shown], [show, { work: null }]]) {
      const rendered = definition.output.render({}, value)
      assert.equal(Array.isArray(rendered), true)
      assert.equal(rendered.every((block) => block.type === 'text' && typeof block.text === 'string'), true)
    }
    assert.match(create.output.render({}, created)[0].text, /已立项《工具立项》/)
    assert.match(show.output.render({}, { work: null })[0].text, /还没有立项/)

    dispose()
    assert.equal(registered.size, 0)
  } finally {
    await cleanup(root)
  }
})

test('a broken identity file makes both tools fail with the file and field', async () => {
  const root = await workspace()
  try {
    await writeFile(join(root, WORK_FILE), JSON.stringify({ version: 9 }), 'utf8')
    const { registered, ctx } = services(root)
    installWorkTools(ctx)
    await assert.rejects(registered.get(WORK_SHOW_NAME).execute({}, exec), /work\.json: /)
    // 坏文件先报字段，而不是「已存在」——作者手改出错时前者才有用。
    await assert.rejects(registered.get(WORK_CREATE_NAME).execute({ title: 'x' }, exec), /字段 version/)
  } finally {
    await cleanup(root)
  }
})

test('every registered schema stays inside the runtime subset', () => {
  for (const schema of [storyNextParameters, storyNextOutput, workCreateParameters, workCreateOutput, workShowOutput]) {
    assert.deepEqual(violations(schema), [])
  }
})
