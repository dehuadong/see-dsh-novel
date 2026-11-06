import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, normalize } from 'node:path'

import { installCastContext, readCast, renderCastContext } from '../src/pipelines/long/cast.ts'
import { installFoundationTools } from '../src/pipelines/long/tools.ts'

const MAJOR = 'source/story/roles/主要角色'
const MINOR = 'source/story/roles/次要角色'

/** 一根带若干角色卡的作品目录。 */
async function work(files = {}) {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-cast-'))
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content, 'utf8')
  }
  return root
}

const cleanup = (root) => rm(root, { recursive: true, force: true })
const read = (root, path) => readFile(join(root, path), 'utf8')

/** 注册工具与命令的替身宿主。 */
async function harness() {
  const root = await work({})
  const tools = new Map()
  const ctx = {
    tools: {
      register(definition) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
    workingDirectory: { ensure: async () => root, get: () => root },
    commands: { register: () => () => {} },
    systemPrompt: { context: () => () => {} },
    get: () => undefined,
  }
  const dispose = installFoundationTools(ctx)
  return { root, tools, dispose, exec: { agent: { session: { snapshotEvents: () => [] } } } }
}

test('readCast groups both tiers and sorts them by name', async () => {
  const root = await work({
    [`${MAJOR}/沈砚.md`]: '# 沈砚\n\n主角。\n',
    [`${MAJOR}/裴照.md`]: '# 裴照\n\n对手。\n',
    [`${MINOR}/韩九.md`]: '# 韩九\n\n配角。\n',
  })
  try {
    const cast = readCast(root)
    assert.deepEqual(cast.problems, [])
    assert.deepEqual(cast.major.map((card) => card.name), ['沈砚', '裴照'])
    assert.deepEqual(cast.minor.map((card) => card.name), ['韩九'])
    assert.equal(cast.major[0].path, `${MAJOR}/沈砚.md`)
    assert.equal(cast.minor[0].tier, 'minor')
  } finally {
    await cleanup(root)
  }
})

test('readCast reports a missing roles directory as just an empty cast', async () => {
  const root = await work()
  try {
    const cast = readCast(root)
    assert.deepEqual(cast, { major: [], minor: [], problems: [] })
  } finally {
    await cleanup(root)
  }
})

test('renderCastContext writes the index, one block per card, and the closing rule', async () => {
  const root = await work({
    [`${MAJOR}/沈砚.md`]: '# 沈砚\n\n**身份**：收骨吏。  \n\n',
    [`${MINOR}/韩九.md`]: '# 韩九\n\n**身份**：掮客。\n',
  })
  try {
    const text = renderCastContext(readCast(root))
    assert.match(text, /^## 人物档案（唯一来源：source\/story\/roles\/）/)
    assert.match(text, /\[roles:index\]\n主要角色：沈砚\n次要角色：韩九/)
    // 卡内容逐字进入：行尾空格保留，只去掉卡末尾的换行。
    assert.ok(text.includes('[role:沈砚]\n# 沈砚\n\n**身份**：收骨吏。  \n\n[role:韩九]'))
    assert.match(text, /\[role:韩九\]\n# 韩九/)
    assert.match(text, /以上人物档案是唯一来源/)
    assert.doesNotMatch(text, /\[cast-problem\]/)
  } finally {
    await cleanup(root)
  }
})

test('an empty cast renders nothing at all', async () => {
  const root = await work()
  try {
    assert.equal(renderCastContext(readCast(root)), '')
  } finally {
    await cleanup(root)
  }
})

test('the same name in both tiers is reported and neither card is rendered', async () => {
  const root = await work({
    [`${MAJOR}/沈砚.md`]: '# 沈砚\n\n主线版。\n',
    [`${MINOR}/沈砚.md`]: '# 沈砚\n\n支线版。\n',
    [`${MINOR}/韩九.md`]: '# 韩九\n\n配角。\n',
  })
  try {
    const cast = readCast(root)
    assert.deepEqual(cast.major, [])
    assert.deepEqual(cast.minor.map((card) => card.name), ['韩九'])
    assert.equal(cast.problems.length, 1)
    assert.match(cast.problems[0], /沈砚 在主要角色与次要角色各有一张卡/)

    const text = renderCastContext(cast)
    assert.doesNotMatch(text, /\[role:沈砚\]/)
    assert.match(text, /\[role:韩九\]/)
    assert.match(text, /\[cast-problem\]\n.*沈砚/)
  } finally {
    await cleanup(root)
  }
})

test('an empty card is reported instead of being injected', async () => {
  const root = await work({
    [`${MAJOR}/沈砚.md`]: '  \n\n',
    [`${MAJOR}/裴照.md`]: '# 裴照\n',
  })
  try {
    const cast = readCast(root)
    assert.deepEqual(cast.major.map((card) => card.name), ['裴照'])
    assert.match(cast.problems[0], /是空卡/)
  } finally {
    await cleanup(root)
  }
})

test('a work whose only card is empty still reports the problem block', async () => {
  const root = await work({ [`${MAJOR}/沈砚.md`]: '  \n\n' })
  try {
    const text = renderCastContext(readCast(root))
    assert.match(text, /^## 人物档案/)
    assert.doesNotMatch(text, /\[roles:index\]/)
    assert.match(text, /\[cast-problem\]\n.*是空卡/)
  } finally {
    await cleanup(root)
  }
})

test('a tier path that is not a directory is reported instead of failing the assembly', async () => {
  const root = await work({ [`${MAJOR}`]: '这不是目录\n' })
  try {
    const cast = readCast(root)
    assert.deepEqual(cast.major, [])
    assert.equal(cast.problems.length, 1)
    assert.match(cast.problems[0], /读不了角色目录 主要角色\//)
    assert.match(renderCastContext(cast), /\[cast-problem\]/)
  } finally {
    await cleanup(root)
  }
})

test('the context contribution carries the agreed placement flags', async () => {
  const root = await work({ [`${MAJOR}/沈砚.md`]: '# 沈砚\n' })
  const ours = {}
  let contribution
  const ctx = {
    systemPrompt: { context(value) { contribution = value; return () => {} } },
    workingDirectory: { ensure: async () => root, get: () => root },
    get: (name) => name === 'agentPresets'
      ? { composedPreset: (agentCtx) => (agentCtx === ours ? 'see-dsh-novel' : 'standard') }
      : undefined,
  }
  try {
    const dispose = installCastContext(ctx, 'see-dsh-novel')
    assert.equal(contribution.name, 'story:cast')
    assert.equal(contribution.order, 130)
    assert.equal(contribution.interpolate, false)
    assert.equal(contribution.required, true)
    assert.equal(typeof dispose, 'function')

    const session = { snapshotEvents: () => [] }
    assert.equal(contribution.text({}), '')
    assert.equal(contribution.text({ agent: { session, ctx: {} } }), '')
    assert.match(contribution.text({ agent: { session, ctx: ours } }), /\[role:沈砚\]/)
  } finally {
    await cleanup(root)
  }
})

test('without the preset registry the contribution stays empty', async () => {
  const root = await work({ [`${MAJOR}/沈砚.md`]: '# 沈砚\n' })
  let contribution
  const ctx = {
    systemPrompt: { context(value) { contribution = value; return () => {} } },
    workingDirectory: { ensure: async () => root, get: () => root },
    get: () => undefined,
  }
  try {
    installCastContext(ctx, 'see-dsh-novel')
    assert.equal(contribution.text({ agent: { session: { snapshotEvents: () => [] }, ctx: {} } }), '')
  } finally {
    await cleanup(root)
  }
})

test('a directory without a cast contributes nothing', async () => {
  const root = await work()
  let contribution
  const ctx = {
    systemPrompt: { context(value) { contribution = value; return () => {} } },
    workingDirectory: { ensure: async () => root, get: () => root },
    get: (name) => name === 'agentPresets' ? { composedPreset: () => 'see-dsh-novel' } : undefined,
  }
  try {
    installCastContext(ctx, 'see-dsh-novel')
    assert.equal(contribution.text({ agent: { session: { snapshotEvents: () => [] }, ctx: {} } }), '')
  } finally {
    await cleanup(root)
  }
})

test('the cast index refuses empty, repeated and collision-prone names', async () => {
  const { tools, dispose, exec } = await harness()
  try {
    const index = tools.get('story_foundation_cast_index')
    await assert.rejects(index.execute({ roles: [{ tier: 'major', name: '  ' }] }, exec), /角色名不能为空/)
    await assert.rejects(
      index.execute({ roles: [{ tier: 'major', name: '甲' }, { tier: 'minor', name: '甲' }] }, exec),
      /角色重复：甲/,
    )
    await assert.rejects(
      index.execute({ roles: [{ tier: 'major', name: '乙/丙' }, { tier: 'major', name: '乙_丙' }] }, exec),
      /两个角色会写进同一个文件/,
    )
  } finally {
    dispose()
  }
})

test('re-tiering a role deletes the card it leaves behind, even in init mode', async () => {
  const { root, tools, dispose, exec } = await harness()
  try {
    await tools.get('story_foundation_cast_index').execute({ roles: [{ tier: 'major', name: '甲' }] }, exec)
    await tools.get('story_foundation_cast_documents').execute({ role_1_content: '卡甲', mode: 'init' }, exec)
    assert.equal(await read(root, `${MAJOR}/甲.md`), '卡甲\n')

    await tools.get('story_foundation_cast_index').execute({ roles: [{ tier: 'minor', name: '甲' }] }, exec)
    const result = await tools.get('story_foundation_cast_documents').execute({ role_1_content: '卡甲', mode: 'init' }, exec)

    assert.deepEqual(result.deleted, [normalize(`${MAJOR}/甲.md`)])
    assert.equal(await read(root, `${MINOR}/甲.md`), '卡甲\n')
    await assert.rejects(read(root, `${MAJOR}/甲.md`))
  } finally {
    dispose()
    await cleanup(root)
  }
})

test('re-tiering during revise deletes the old card exactly once', async () => {
  const { root, tools, dispose, exec } = await harness()
  try {
    const index = tools.get('story_foundation_cast_index')
    const cards = () => tools.get('story_foundation_cast_documents')

    await index.execute({ roles: [{ tier: 'major', name: '甲' }] }, exec)
    await cards().execute({ role_1_content: '卡甲', mode: 'init' }, exec)

    await index.execute({ roles: [{ tier: 'minor', name: '甲' }] }, exec)
    const result = await cards().execute({ role_1_content: '卡甲二版', mode: 'revise' }, exec)

    assert.deepEqual(result.deleted, [normalize(`${MAJOR}/甲.md`)])
    assert.equal(await read(root, `${MINOR}/甲.md`), '卡甲二版\n')
  } finally {
    dispose()
    await cleanup(root)
  }
})

test('init still keeps unrelated cards that are not re-submitted', async () => {
  const { root, tools, dispose, exec } = await harness()
  try {
    const index = tools.get('story_foundation_cast_index')
    const cards = () => tools.get('story_foundation_cast_documents')

    await index.execute({ roles: [{ tier: 'minor', name: '乙' }] }, exec)
    await cards().execute({ role_1_content: '卡乙', mode: 'init' }, exec)

    await index.execute({ roles: [{ tier: 'major', name: '甲' }] }, exec)
    const result = await cards().execute({ role_1_content: '卡甲', mode: 'init' }, exec)

    assert.deepEqual(result.deleted, [])
    assert.equal(await read(root, `${MINOR}/乙.md`), '卡乙\n')
  } finally {
    dispose()
    await cleanup(root)
  }
})

test('an empty card body is refused before anything is written', async () => {
  const { root, tools, dispose, exec } = await harness()
  try {
    await tools.get('story_foundation_cast_index').execute({ roles: [{ tier: 'major', name: '甲' }] }, exec)
    await assert.rejects(
      tools.get('story_foundation_cast_documents').execute({ role_1_content: '   ', mode: 'init' }, exec),
      /角色卡内容不能为空：甲/,
    )
    await assert.rejects(read(root, `${MAJOR}/甲.md`))
  } finally {
    dispose()
    await cleanup(root)
  }
})
