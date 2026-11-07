import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseProposal, proposalCard } from '../src/core/proposal.ts'
import { installProposalTool, PROPOSE_NAME, proposeOutput, proposeParameters } from '../src/plugin/proposal-tool.ts'
import { readWork, workProbes, writeWork } from '../src/core/work.ts'
import { storyNext } from '../src/plugin/story-next.ts'
import { violations } from './support/schema-subset.mjs'

async function workspace() {
  return mkdtemp(join(tmpdir(), 'see-dsh-novel-proposal-'))
}

const cleanup = (root) => rm(root, { recursive: true, force: true })

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** 假 ctx：工作目录 + 可选 approval 服务。 */
function services(root, approval) {
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
      get(name) { return name === 'approval' ? approval : undefined },
    },
  }
}

/** 一个可编排结果的 approval 服务；记录收到的请求。 */
function fakeApproval(outcome, { policy = 'ask' } = {}) {
  const requests = []
  return {
    requests,
    service: {
      config: { policy },
      overrideOf: () => undefined,
      request: async (request) => {
        requests.push(request)
        return outcome
      },
    },
  }
}

const exec = { agent: { session: { id: 'session-root', snapshotEvents: () => [] } }, callId: 'call_1' }

const full = {
  title: '夜班司机',
  summary: '一本夜班出租车司机撞见城市另一面的都市悬疑。',
  instruction: '写《夜班司机》的第一卷大纲与基础设定，都市悬疑，中文，目标 120 章。',
  createBook: {
    title: '夜班司机',
    genre: '都市悬疑',
    platform: '起点',
    language: 'zh',
    targetChapters: 120,
    chapterWordCount: 2600,
    minChapterLength: 2400,
    maxChapterLength: 2800,
  },
}

test('the draft rejects missing or invalid fields', () => {
  assert.throws(() => parseProposal({ summary: 'x' }), /title/)
  assert.throws(() => parseProposal({ title: '书', summary: '   ' }), /summary/)
  assert.throws(() => parseProposal({ title: '书', summary: 's' }), /instruction/)
  assert.throws(() => parseProposal({ title: '书', summary: 's', instruction: '  ' }), /instruction/)
  assert.throws(() => parseProposal({ title: '书', summary: 's', instruction: 'i', language: 'fr' }), /language/)
  assert.throws(() => parseProposal({ title: '书', summary: 's', instruction: 'i', chapters: 0 }), /chapters/)
  assert.throws(() => parseProposal({ title: '书', summary: 's', instruction: 'i', chapterWords: 2.5 }), /chapterWords/)
  assert.throws(() => parseProposal({ title: '书', summary: 's', instruction: 'i', minChapterLength: 3000, maxChapterLength: 2000 }), /minChapterLength/)
  const draft = parseProposal({ title: ' 书 ', summary: ' 一句 ', instruction: ' 写 ' })
  assert.equal(draft.title, '书')
  assert.equal(draft.summary, '一句')
  assert.equal(draft.instruction, ' 写 ', 'instruction 原样保留')
  assert.equal(draft.language, 'zh')
  assert.equal(draft.targetChapters, undefined)
  assert.equal(draft.chapterWordCount, undefined)
})

test('a bracketed title is not wrapped twice on the card', () => {
  const card = proposalCard(parseProposal({ title: '《夜班司机》', summary: 's', instruction: '写第一卷' }))
  assert.match(card, /^立项《夜班司机》｜中文\ns\n\nInstruction: 写第一卷$/)
})

test('the card carries the confirmed fields and omits the missing ones', () => {
  const card = proposalCard(parseProposal({ title: '夜班司机', summary: full.summary, instruction: full.instruction, genre: '都市悬疑', platform: '起点', language: 'zh', chapters: 120, chapterWords: 2600 }))
  assert.match(card, /立项《夜班司机》/)
  assert.match(card, /都市悬疑 · 起点 · 中文 · 目标 120 章 × 单章 2600 字/)
  assert.match(card, /撞见城市另一面/)
  assert.match(card, /Instruction: 写《夜班司机》/)
  // 作者没给规模时卡片不编造数字；默认值只在批准写盘时补。
  assert.equal(
    proposalCard(parseProposal({ title: '书', summary: 's', instruction: 'i' })),
    '立项《书》｜中文\ns\n\nInstruction: i',
  )
  assert.match(proposalCard(parseProposal({ title: 'book', summary: 's', instruction: 'i', language: 'en' })), /English/)
})

test('allowing the card writes work.json with the confirmed fields', async () => {
  const root = await workspace()
  try {
    const controller = new AbortController()
    const approval = fakeApproval('allowed-once')
    const { ctx, registered } = services(root, approval.service)
    installProposalTool(ctx)
    const result = await registered.get(PROPOSE_NAME).execute(full, { ...exec, signal: controller.signal })
    assert.equal(result.created, true)
    assert.equal(result.outcome, 'allowed-once')
    assert.match(result.summary, /《夜班司机》/)
    assert.match(result.summary, /目标 120 章/)

    const work = await readWork(root)
    assert.equal(work.title, '夜班司机')
    assert.equal(work.language, 'zh')
    assert.deepEqual(work.metadata, {
      targetChapters: 120,
      chapterWordCount: 2600,
      genre: '都市悬疑',
      platform: '起点',
      minChapterLength: 2400,
      maxChapterLength: 2800,
    })
    // 建书同一次提交写身份、外部上下文与方向文档兜底。
    assert.equal(await readFile(join(root, 'source/story/brief.md'), 'utf8'), full.instruction)
    assert.equal(await readFile(join(root, 'source/story/author_intent.md'), 'utf8'), `${full.instruction}\n`)
    assert.match(await readFile(join(root, 'source/story/current_focus.md'), 'utf8'), /^# 当前聚焦/)
    assert.deepEqual((await readdir(root)).sort(), ['source', 'work.json'])
    // 立项后的路牌是 foundation。
    assert.equal(storyNext(await workProbes(root)).phase, 'foundation')
    const rendered = registered.get(PROPOSE_NAME).output.render({}, result)
    assert.equal(rendered[0].text, `已立项${result.summary}`)
    assert.equal(approval.requests.length, 1)
    assert.equal(approval.requests[0].callId, 'call_1')
    assert.equal(approval.requests[0].toolName, 'story_propose')
    assert.match(approval.requests[0].reason, /立项《夜班司机》/)
    // 取消卡片时确认条要能连带收回：signal 原样传下去。
    assert.equal(approval.requests[0].signal, controller.signal)
  } finally {
    await cleanup(root)
  }
})

test('approval fills the default scale when the author gave none', async () => {
  const root = await workspace()
  try {
    const approval = fakeApproval('allowed-once')
    const { ctx, registered } = services(root, approval.service)
    installProposalTool(ctx)
    const result = await registered.get(PROPOSE_NAME).execute({
      title: '默认规模',
      summary: '一句摘要',
      instruction: '  写《默认规模》的基础设定，中文。  ',
      createBook: { title: '默认规模' },
    }, exec)
    assert.equal(result.created, true)
    const work = await readWork(root)
    assert.deepEqual(work.metadata, { targetChapters: 200, chapterWordCount: 3000 })
    // instruction 原样进 brief；author_intent 只去尾部空白再加换行。
    assert.equal(await readFile(join(root, 'source/story/brief.md'), 'utf8'), '  写《默认规模》的基础设定，中文。  ')
    assert.equal(await readFile(join(root, 'source/story/author_intent.md'), 'utf8'), '  写《默认规模》的基础设定，中文。\n')
  } finally {
    await cleanup(root)
  }
})

for (const outcome of ['rejected', 'cancelled', 'unavailable']) {
  test(`${outcome} writes nothing and reports the outcome`, async () => {
    const root = await workspace()
    try {
      const approval = fakeApproval(outcome)
      const { ctx, registered } = services(root, approval.service)
      installProposalTool(ctx)
      const result = await registered.get(PROPOSE_NAME).execute(full, exec)
      assert.equal(result.created, false)
      assert.equal(result.outcome, outcome)
      assert.equal(result.summary, null)
      assert.equal(await exists(join(root, 'work.json')), false)
      const rendered = registered.get(PROPOSE_NAME).output.render({}, result)
      assert.match(rendered[0].text, new RegExp(`未立项（${outcome}）`))
      assert.doesNotMatch(rendered[0].text, /下一步/)
      if (outcome === 'unavailable') assert.match(rendered[0].text, /story-init/)
      else assert.match(rendered[0].text, /想改哪一处/)
    } finally {
      await cleanup(root)
    }
  })
}

test('a missing approval service or the never policy writes nothing', async () => {
  const root = await workspace()
  try {
    const noService = services(root, undefined)
    installProposalTool(noService.ctx)
    const first = await noService.registered.get(PROPOSE_NAME).execute(full, exec)
    assert.equal(first.outcome, 'unavailable')
    assert.equal(await exists(join(root, 'work.json')), false)

    const never = fakeApproval('allowed-once', { policy: 'never' })
    const withNever = services(root, never.service)
    installProposalTool(withNever.ctx)
    const second = await withNever.registered.get(PROPOSE_NAME).execute(full, exec)
    assert.equal(second.outcome, 'unavailable')
    assert.equal(never.requests.length, 0, '策略 never 时不该弹确认条')
    assert.equal(await exists(join(root, 'work.json')), false)
  } finally {
    await cleanup(root)
  }
})

test('an existing work is refused before the proposal fields are judged', async () => {
  const root = await workspace()
  try {
    await writeWork(root, { title: '已经有的书' })
    const before = await readFile(join(root, 'work.json'), 'utf8')
    const approval = fakeApproval('allowed-once')
    const { ctx, registered } = services(root, approval.service)
    installProposalTool(ctx)
    await assert.rejects(registered.get(PROPOSE_NAME).execute(full, exec), /已经立项/)
    // 字段非法也先报「已立项」：顺序是「身份 → 字段」。
    await assert.rejects(registered.get(PROPOSE_NAME).execute({ title: '' }, exec), /已经立项/)
    assert.equal(await readFile(join(root, 'work.json'), 'utf8'), before)
    assert.equal(approval.requests.length, 0)
  } finally {
    await cleanup(root)
  }
})

test('work metadata round-trips genre and platform, and old files still parse', async () => {
  const root = await workspace()
  try {
    await writeWork(root, { title: '字段', genre: '科幻', platform: '番茄' })
    const work = await readWork(root)
    assert.equal(work.metadata.genre, '科幻')
    assert.equal(work.metadata.platform, '番茄')

    // 旧格式：没有 genre/platform，解析照旧。
    const legacy = JSON.parse(await readFile(join(root, 'work.json'), 'utf8'))
    delete legacy.metadata.genre
    delete legacy.metadata.platform
    await rm(join(root, 'work.json'))
    await writeFile(join(root, 'work.json'), `${JSON.stringify(legacy, null, 2)}\n`, 'utf8')
    const parsed = await readWork(root)
    assert.deepEqual(parsed.metadata, {})
  } finally {
    await cleanup(root)
  }
})

test('the schemas stay inside the runtime subset', () => {
  assert.deepEqual(violations(proposeParameters), [])
  assert.deepEqual(violations(proposeOutput), [])
})

test('the nested createBook shape is required and validated', async () => {
  const root = await workspace()
  try {
    const { ctx, registered } = services(root, fakeApproval('allowed-once').service)
    installProposalTool(ctx)
    const tool = registered.get(PROPOSE_NAME)
    await assert.rejects(tool.execute({ title: 't', summary: 's', instruction: 'i' }, exec), /createBook/)
    await assert.rejects(tool.execute({ title: 't', summary: 's', instruction: 'i', createBook: {} }, exec), /title/)
    await assert.rejects(tool.execute({ title: 't', summary: 's', instruction: 'i', createBook: { title: 'b', minChapterLength: 3000, maxChapterLength: 2000 } }, exec), /minChapterLength/)
    assert.equal(await readWork(root), null)
  } finally {
    await cleanup(root)
  }
})

test('the card title and the work title are separate fields', async () => {
  const root = await workspace()
  try {
    const { ctx, registered } = services(root, fakeApproval('allowed-once').service)
    installProposalTool(ctx)
    const result = await registered.get(PROPOSE_NAME).execute({
      title: '夜行（提案名）',
      summary: '一句摘要',
      instruction: '写《夜行长街》的基础设定。',
      createBook: { title: '夜行长街', language: 'zh' },
    }, exec)
    assert.equal(result.created, true)
    assert.match(result.card, /立项《夜行（提案名）》/)
    assert.equal((await readWork(root)).title, '夜行长街')
  } finally {
    await cleanup(root)
  }
})
