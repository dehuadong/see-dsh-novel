import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { COMMAND_INIT, installInitCommand, parseWorkCreate, prepareCommandRoot, resolveCommandLanguage } from '../src/plugin/work-command.ts'
import { WORK_FILE } from '../src/core/work.ts'

/** 一个空的临时工作区。 */
async function workspace() {
  return mkdtemp(join(tmpdir(), 'see-dsh-novel-init-'))
}

const cleanup = (root) => rm(root, { recursive: true, force: true })

/** 只带命令与工作目录两个面的假 ctx。 */
function services(root) {
  const commands = new Map()
  return {
    commands,
    ctx: {
      commands: {
        register(definition) {
          commands.set(definition.name, definition)
          return () => commands.delete(definition.name)
        },
      },
      workingDirectory: { ensure: async () => root, get: () => root },
    },
  }
}

const exec = {
  agent: { session: { snapshotEvents: () => [] }, followup: () => {} },
  rawInput: '',
  signal: new AbortController().signal,
}

const defaultMetadata = () => ({
  targetChapters: 200,
  chapterWordCount: 3000,
  genre: 'xuanhuan',
  platform: 'tomato',
})

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

test('parseWorkCreate reads the title, options and defaults', () => {
  assert.deepEqual(parseWorkCreate('《夜行测试》'), { title: '《夜行测试》', ...defaultMetadata() })
  assert.deepEqual(
    parseWorkCreate('  夜行 测试  --lang en --chapters 80 --words 2500 '),
    {
      title: '夜行 测试',
      language: 'en',
      languageProvided: true,
      ...defaultMetadata(),
      targetChapters: 80,
      chapterWordCount: 2500,
    },
  )
  assert.equal(parseWorkCreate('标题 --brief briefs/创作.md').brief, 'briefs/创作.md')
  assert.equal(parseWorkCreate('标题 --genre 都市悬疑').genre, '都市悬疑')
})

test('parseWorkCreate accepts the canonical option names, inline values and last-wins repeats', () => {
  const canonical = parseWorkCreate('标题 --target-chapters 80 --chapter-words 2500')
  assert.deepEqual(parseWorkCreate('标题 --chapters 80 --words 2500'), canonical)
  assert.deepEqual(parseWorkCreate('标题 --target-chapters=80 --chapter-words=2500'), canonical)
  assert.equal(parseWorkCreate('标题 --chapters 80 --target-chapters 90').targetChapters, 90)
  assert.equal(parseWorkCreate('标题 --lang en --lang fr').language, undefined)
  assert.equal(parseWorkCreate('标题 --lang en --lang fr').languageProvided, true)
})

test('parseWorkCreate reads numbers the way parseInt does', () => {
  assert.equal(parseWorkCreate('标题 --target-chapters 2.5').targetChapters, 2)
  assert.equal(parseWorkCreate('标题 --target-chapters 80abc').targetChapters, 80)
  assert.equal(parseWorkCreate('标题 --target-chapters +80').targetChapters, 80)
  assert.equal(parseWorkCreate('标题 --chapters 1e3').targetChapters, 1)
  assert.throws(() => parseWorkCreate('标题 --chapters abc'), /--chapters 取不出整数/)
})

test('parseWorkCreate normalizes --lang prefixes and falls back on unknown values', () => {
  assert.equal(parseWorkCreate('标题 --lang zh-CN').language, 'zh')
  assert.equal(parseWorkCreate('标题 --lang EN').language, 'en')
  assert.equal(parseWorkCreate('标题 --lang fr').language, undefined)
  assert.equal(parseWorkCreate('标题 --lang=').language, undefined)
})

test('parseWorkCreate separates empty option values', () => {
  assert.equal(parseWorkCreate('标题 --brief=').brief, undefined)
  assert.equal(parseWorkCreate('标题 --genre=').genre, '')
  assert.equal(parseWorkCreate('标题 --platform=').platform, '')
  assert.throws(() => parseWorkCreate('标题 --target-chapters='), /--target-chapters 取不出整数/)
  assert.throws(() => parseWorkCreate('标题 --chapter-words='), /--chapter-words 取不出整数/)
})

test('parseWorkCreate keeps the title as the author wrote it', () => {
  // `--` 之后是标题原文：内部空白、`--` 字样都按原样保留。
  assert.deepEqual(parseWorkCreate('-- 带 --lang 的标题'), { title: '带 --lang 的标题', ...defaultMetadata() })
  assert.deepEqual(parseWorkCreate('-- 夜行   测试'), { title: '夜行   测试', ...defaultMetadata() })
  // 标题词被选项隔开时无法按原文取回，退回单空格连接。
  assert.deepEqual(parseWorkCreate('夜行 --lang zh 测试'), {
    title: '夜行 测试',
    language: 'zh',
    languageProvided: true,
    ...defaultMetadata(),
  })
})

test('parseWorkCreate reports the parameter it could not read', () => {
  assert.throws(() => parseWorkCreate(''), /缺少标题/)
  assert.throws(() => parseWorkCreate('--lang zh'), /缺少标题/)
  assert.throws(() => parseWorkCreate('标题 --foo bar'), /未知选项 --foo/)
  assert.throws(() => parseWorkCreate('标题 --foo=bar'), /未知选项 --foo/)
  assert.throws(() => parseWorkCreate('标题 --lang'), /--lang 缺少取值/)
  assert.throws(() => parseWorkCreate('标题 --chapters --lang zh'), /--chapters 缺少取值/)
  assert.throws(() => parseWorkCreate('标题 --chapters abc'), /--chapters 取不出整数/)
})

test('the command writes work.json and reports the identity', async () => {
  const root = await workspace()
  try {
    const { commands, ctx } = services(root)
    const dispose = installInitCommand(ctx)
    assert.deepEqual([...commands.keys()], [COMMAND_INIT])
    // 不声明 input 时输入框会在选中命令后立即派发，参数没有机会输入。
    assert.match(commands.get(COMMAND_INIT).input.hint, /--target-chapters N/)
    assert.match(commands.get(COMMAND_INIT).input.hint, /--chapters／--words 为规模别名/)

    const result = await commands.get(COMMAND_INIT).handler({ ...exec, rawInput: '《夜行测试》 --lang en --chapters 80 --words 2500' })
    assert.equal(result.kind, 'success')
    assert.equal(
      result.text,
      '已立项《夜行测试》：longform-novel，en，draft（目标 80 章，单章 2500 字，xuanhuan，tomato）\n'
        + '基础设定已启动：按 story_next 的指示完成 outline、details 与角色卡，不要开始写正文。',
    )

    assert.equal(await readFile(join(root, 'source/story/brief.md'), 'utf8'), 'Create 《夜行测试》')
    assert.equal(await readFile(join(root, 'source/story/author_intent.md'), 'utf8'), 'Create 《夜行测试》\n')

    const onDisk = JSON.parse(await readFile(join(root, WORK_FILE), 'utf8'))
    assert.equal(onDisk.title, '《夜行测试》')
    assert.equal(onDisk.language, 'en')
    assert.deepEqual(onDisk.metadata, {
      ...defaultMetadata(),
      targetChapters: 80,
      chapterWordCount: 2500,
    })

    // 第二次立项：当前作品只有身份、基础设定未完成，按源行为清理内容后重建。
    const again = await commands.get(COMMAND_INIT).handler({ ...exec, rawInput: '另一部' })
    assert.equal(again.kind, 'success')
    assert.match(again.text, /已立项《另一部》/)
    assert.equal(JSON.parse(await readFile(join(root, WORK_FILE), 'utf8')).title, '另一部')

    dispose()
    assert.equal(commands.size, 0)
  } finally {
    await cleanup(root)
  }
})

test('the default language and scale still fall back to zh and 200 x 3000', async () => {
  const root = await workspace()
  try {
    const { commands, ctx } = services(root)
    installInitCommand(ctx)
    const result = await commands.get(COMMAND_INIT).handler({ ...exec, rawInput: '夜行测试' })
    assert.equal(result.kind, 'success')
    assert.equal(
      result.text,
      '已立项《夜行测试》：longform-novel，zh，draft（目标 200 章，单章 3000 字，xuanhuan，tomato）\n'
        + '基础设定已启动：按 story_next 的指示完成 outline、details 与角色卡，不要开始写正文。',
    )
    assert.equal(await readFile(join(root, 'source/story/brief.md'), 'utf8'), 'Create 夜行测试')
    const onDisk = JSON.parse(await readFile(join(root, WORK_FILE), 'utf8'))
    assert.equal(onDisk.language, 'zh')
    assert.deepEqual(onDisk.metadata, defaultMetadata())
  } finally {
    await cleanup(root)
  }
})

test('the command accepts the canonical names and inline values', async () => {
  const root = await workspace()
  try {
    const { commands, ctx } = services(root)
    installInitCommand(ctx)
    const result = await commands.get(COMMAND_INIT).handler({
      ...exec,
      rawInput: '内联写法 --target-chapters=80 --chapter-words=2500 --lang=zh-CN',
    })
    assert.equal(result.kind, 'success')
    const onDisk = JSON.parse(await readFile(join(root, WORK_FILE), 'utf8'))
    assert.equal(onDisk.language, 'zh')
    assert.deepEqual(onDisk.metadata, {
      ...defaultMetadata(),
      targetChapters: 80,
      chapterWordCount: 2500,
    })
  } finally {
    await cleanup(root)
  }
})

test('a later size option wins over an earlier alias', async () => {
  const root = await workspace()
  try {
    const { commands, ctx } = services(root)
    installInitCommand(ctx)
    const result = await commands.get(COMMAND_INIT).handler({
      ...exec,
      rawInput: '重复 --chapters 80 --target-chapters 90',
    })
    assert.equal(result.kind, 'success')
    const onDisk = JSON.parse(await readFile(join(root, WORK_FILE), 'utf8'))
    assert.equal(onDisk.metadata.targetChapters, 90)
  } finally {
    await cleanup(root)
  }
})

test('--brief reads a file relative to the workspace root', async () => {
  const root = await workspace()
  try {
    const { commands, ctx } = services(root)
    installInitCommand(ctx)
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(root, 'briefs'), { recursive: true })
    await writeFile(join(root, 'briefs/创作.md'), '  自定义简报内容  \n', 'utf8')
    const result = await commands.get(COMMAND_INIT).handler({ ...exec, rawInput: '带简报 --brief briefs/创作.md' })
    assert.equal(result.kind, 'success')
    assert.equal(await readFile(join(root, 'source/story/brief.md'), 'utf8'), '自定义简报内容')
    // 越界的简报路径被拒绝。
    await assert.rejects(
      commands.get(COMMAND_INIT).handler({ ...exec, rawInput: '越界 --brief ../x.md' }).then((r) => {
        if (r.kind === 'error') throw new Error(r.text)
        return r
      }),
      /留在作品根内|ENOENT/,
    )
  } finally {
    await cleanup(root)
  }
})

test('--brief= means no brief and keeps the generated instruction', async () => {
  const root = await workspace()
  try {
    const { commands, ctx } = services(root)
    installInitCommand(ctx)
    const result = await commands.get(COMMAND_INIT).handler({ ...exec, rawInput: '没简报 --brief=' })
    assert.equal(result.kind, 'success')
    assert.equal(await readFile(join(root, 'source/story/brief.md'), 'utf8'), 'Create 没简报')
  } finally {
    await cleanup(root)
  }
})

test('an unknown language falls back to zh instead of failing', async () => {
  const root = await workspace()
  try {
    const { commands, ctx } = services(root)
    installInitCommand(ctx)
    const result = await commands.get(COMMAND_INIT).handler({ ...exec, rawInput: '回落 --lang fr' })
    assert.equal(result.kind, 'success')
    assert.match(result.text, /zh/)
    const onDisk = JSON.parse(await readFile(join(root, WORK_FILE), 'utf8'))
    assert.equal(onDisk.language, 'zh')
  } finally {
    await cleanup(root)
  }
})

test('2.5 chapters follows parseInt and writes two chapters', async () => {
  const root = await workspace()
  try {
    const { commands, ctx } = services(root)
    installInitCommand(ctx)
    const result = await commands.get(COMMAND_INIT).handler({ ...exec, rawInput: '截断 --chapters 2.5' })
    assert.equal(result.kind, 'success')
    const onDisk = JSON.parse(await readFile(join(root, WORK_FILE), 'utf8'))
    assert.equal(onDisk.metadata.targetChapters, 2)
  } finally {
    await cleanup(root)
  }
})

test('empty and invalid values both come back as command errors without writing', async () => {
  const root = await workspace()
  try {
    const { commands, ctx } = services(root)
    installInitCommand(ctx)
    const handler = commands.get(COMMAND_INIT).handler

    for (const [rawInput, pattern] of [
      ['', /缺少标题/],
      ['标题 --chapters abc', /--chapters 取不出整数/],
      ['标题 --target-chapters=', /--target-chapters 取不出整数/],
      ['标题 --chapter-words=', /--chapter-words 取不出整数/],
      ['标题 --genre=', /genre/],
      ['标题 --platform=', /platform/],
      ['标题 --chapters 0', /targetChapters/],
      ['标题 --chapters -5', /targetChapters/],
    ]) {
      const result = await handler({ ...exec, rawInput })
      assert.equal(result.kind, 'error', rawInput)
      assert.match(result.text, pattern)
      assert.equal(await exists(join(root, WORK_FILE)), false, rawInput)
    }
  } finally {
    await cleanup(root)
  }
})

test('a corrupt work.json is treated as an incomplete work and rebuilt', async () => {
  const root = await workspace()
  try {
    await writeFile(join(root, WORK_FILE), JSON.stringify({ version: 9 }), 'utf8')
    const { commands, ctx } = services(root)
    installInitCommand(ctx)
    const result = await commands.get(COMMAND_INIT).handler({ ...exec, rawInput: '标题' })
    assert.equal(result.kind, 'success')
    assert.equal(JSON.parse(await readFile(join(root, WORK_FILE), 'utf8')).title, '标题')
  } finally {
    await cleanup(root)
  }
})

test('a successful init queues exactly one foundation turn', async () => {
  const root = await workspace()
  try {
    const messages = []
    const { commands, ctx } = services(root)
    installInitCommand(ctx)
    const agent = { session: { snapshotEvents: () => [] }, followup: (message) => messages.push(message) }
    const result = await commands.get(COMMAND_INIT).handler({ ...exec, agent, rawInput: '标题' })
    assert.equal(result.kind, 'success')
    assert.equal(messages.length, 1)
    assert.equal(messages[0].role, 'user')
    assert.deepEqual(messages[0].source, { kind: 'story-command', command: 'story-init' })
    assert.match(messages[0].content[0].text, /story_next/)
    assert.match(messages[0].content[0].text, /不要开始写正文/)
    assert.match(messages[0].content[0].text, /不要开始写正文/)
  } finally {
    await cleanup(root)
  }
})

test('a followup failure is an error but keeps the written identity', async () => {
  const root = await workspace()
  try {
    const { commands, ctx } = services(root)
    installInitCommand(ctx)
    const agent = { session: { snapshotEvents: () => [] }, followup: () => { throw new Error('会话已关闭') } }
    const result = await commands.get(COMMAND_INIT).handler({ ...exec, agent, rawInput: '标题' })
    assert.equal(result.kind, 'error')
    assert.match(result.text, /基础设定未启动/)
    assert.equal(JSON.parse(await readFile(join(root, WORK_FILE), 'utf8')).title, '标题')
  } finally {
    await cleanup(root)
  }
})

test('language falls back through inkos.json, locale variables and zh', async () => {
  const root = await workspace()
  try {
    await writeFile(join(root, 'inkos.json'), JSON.stringify({}), 'utf8')
    assert.equal(await resolveCommandLanguage(root, { languageProvided: false }, { LANG: 'en_US.UTF-8' }), 'zh')
    await rm(join(root, 'inkos.json'))
    assert.equal(await resolveCommandLanguage(root, { languageProvided: false }, { LANG: 'en_US.UTF-8' }), 'en')
    assert.equal(await resolveCommandLanguage(root, { languageProvided: true, language: 'fr' }, { LANG: 'en_US.UTF-8' }), 'en')
    assert.equal(await resolveCommandLanguage(root, { languageProvided: true, language: 'fr' }, { INKOS_LOCALE: 'zh_CN', LANG: 'en' }), 'zh')
    assert.equal(await resolveCommandLanguage(root, { languageProvided: false }, {}), 'zh')
    await writeFile(join(root, 'inkos.json'), JSON.stringify({ language: 'en' }), 'utf8')
    assert.equal(await resolveCommandLanguage(root, { languageProvided: false }, { LANG: 'zh_CN' }), 'en')
    await writeFile(join(root, 'inkos.json'), JSON.stringify({ language: 'fr' }), 'utf8')
    await assert.rejects(resolveCommandLanguage(root, { languageProvided: false }, {}), /language 必须是 zh 或 en/)
  } finally {
    await cleanup(root)
  }
})

test('reinit rejects a complete work and clears only an incomplete content root', async () => {
  const root = await workspace()
  try {
    await writeFile(join(root, WORK_FILE), JSON.stringify({ version: 1 }), 'utf8')
    await mkdir(join(root, 'source/story/outline'), { recursive: true })
    for (const path of [
      'source/story/outline/story_frame.md',
      'source/story/outline/volume_map.md',
      'source/story/book_rules.md',
      'source/story/book_rules.json',
      'source/story/pending_hooks.md',
    ]) await writeFile(join(root, path), 'x', 'utf8')
    await assert.rejects(prepareCommandRoot(root), /已经存在完整作品/)
    await rm(join(root, 'source/story/outline/volume_map.md'))
    await writeFile(join(root, 'notes.md'), '保留', 'utf8')
    await writeFile(join(root, 'source/partial.md'), '删除', 'utf8')
    await prepareCommandRoot(root)
    assert.equal(await exists(join(root, WORK_FILE)), false)
    assert.equal(await exists(join(root, 'source')), false)
    assert.equal(await readFile(join(root, 'notes.md'), 'utf8'), '保留')
  } finally {
    await cleanup(root)
  }
})
