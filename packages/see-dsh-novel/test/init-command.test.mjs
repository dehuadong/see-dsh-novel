import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { COMMAND_INIT, installInitCommand, parseInitInput } from '../src/plugin/init-command.ts'
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

const exec = { agent: { session: { snapshotEvents: () => [] } }, rawInput: '', signal: new AbortController().signal }

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

test('parseInitInput reads the title and the three options', () => {
  assert.deepEqual(parseInitInput('《夜行测试》'), { title: '《夜行测试》' })
  assert.deepEqual(
    parseInitInput('  夜行 测试  --lang en --chapters 80 --words 2500 '),
    { title: '夜行 测试', language: 'en', targetChapters: 80, chapterWordCount: 2500 },
  )
})

test('parseInitInput treats everything after -- as the title', () => {
  assert.deepEqual(parseInitInput('-- 带 --lang 的标题'), { title: '带 --lang 的标题' })
})

test('parseInitInput reports the parameter it could not read', () => {
  assert.throws(() => parseInitInput(''), /缺少标题/)
  assert.throws(() => parseInitInput('--lang zh'), /缺少标题/)
  assert.throws(() => parseInitInput('标题 --foo bar'), /未知选项 --foo/)
  assert.throws(() => parseInitInput('标题 --lang zh --lang en'), /--lang 重复/)
  assert.throws(() => parseInitInput('标题 --lang'), /--lang 缺少取值/)
  assert.throws(() => parseInitInput('标题 --chapters 2.5'), /--chapters 必须是整数/)
  assert.throws(() => parseInitInput('标题 --chapters abc'), /--chapters 必须是整数/)
})

test('the command writes work.json and reports the identity', async () => {
  const root = await workspace()
  try {
    const { commands, ctx } = services(root)
    const dispose = installInitCommand(ctx)
    assert.deepEqual([...commands.keys()], [COMMAND_INIT])

    const result = await commands.get(COMMAND_INIT).handler({ ...exec, rawInput: '《夜行测试》 --lang en --chapters 80 --words 2500' })
    assert.equal(result.kind, 'success')
    assert.match(result.text, /已立项《夜行测试》/)
    assert.match(result.text, /en/)
    assert.match(result.text, /目标 80 章/)
    assert.match(result.text, /单章 2500 字/)
    assert.match(result.text, /下一步/)

    const onDisk = JSON.parse(await readFile(join(root, WORK_FILE), 'utf8'))
    assert.equal(onDisk.title, '《夜行测试》')
    assert.equal(onDisk.language, 'en')
    assert.deepEqual(onDisk.metadata, { targetChapters: 80, chapterWordCount: 2500 })

    // 第二次立项：错误文本来自 writeWork，原文件不变。
    const before = await readFile(join(root, WORK_FILE), 'utf8')
    const again = await commands.get(COMMAND_INIT).handler({ ...exec, rawInput: '另一部' })
    assert.equal(again.kind, 'error')
    assert.match(again.text, /已经存在/)
    assert.equal(await readFile(join(root, WORK_FILE), 'utf8'), before)

    dispose()
    assert.equal(commands.size, 0)
  } finally {
    await cleanup(root)
  }
})

test('syntax and semantic errors both come back as command errors without writing', async () => {
  const root = await workspace()
  try {
    const { commands, ctx } = services(root)
    installInitCommand(ctx)
    const handler = commands.get(COMMAND_INIT).handler

    for (const [rawInput, pattern] of [
      ['', /缺少标题/],
      ['标题 --chapters 2.5', /--chapters 必须是整数/],
      ['标题 --lang fr', /language/],
      ['标题 --chapters 0', /targetChapters/],
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

test('a corrupt work.json surfaces its field error', async () => {
  const root = await workspace()
  try {
    await writeFile(join(root, WORK_FILE), JSON.stringify({ version: 9 }), 'utf8')
    const { commands, ctx } = services(root)
    installInitCommand(ctx)
    const result = await commands.get(COMMAND_INIT).handler({ ...exec, rawInput: '标题' })
    assert.equal(result.kind, 'error')
    assert.match(result.text, /字段 version/)
  } finally {
    await cleanup(root)
  }
})
