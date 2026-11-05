import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseProposal, proposalCard } from '../src/core/proposal.ts'
import { installProposalTool, PROPOSE_NAME, proposeOutput, proposeParameters } from '../src/plugin/proposal-tool.ts'
import { readWork, writeWork } from '../src/core/work.ts'
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
  genre: '都市悬疑',
  platform: '起点',
  language: 'zh',
  chapters: 120,
  chapterWords: 2600,
}

test('the draft rejects missing or invalid fields', () => {
  assert.throws(() => parseProposal({ summary: 'x' }), /title/)
  assert.throws(() => parseProposal({ title: '书', summary: '   ' }), /summary/)
  assert.throws(() => parseProposal({ title: '书', summary: 's', language: 'fr' }), /language/)
  assert.throws(() => parseProposal({ title: '书', summary: 's', chapters: 0 }), /chapters/)
  assert.throws(() => parseProposal({ title: '书', summary: 's', chapterWords: 2.5 }), /chapterWords/)
  const draft = parseProposal({ title: ' 书 ', summary: ' 一句 ' })
  assert.equal(draft.title, '书')
  assert.equal(draft.summary, '一句')
  assert.equal(draft.language, 'zh')
})

test('the card carries the confirmed fields and omits the missing ones', () => {
  const card = proposalCard(parseProposal(full))
  assert.match(card, /立项《夜班司机》/)
  assert.match(card, /都市悬疑 · 起点 · 中文 · 目标 120 章 · 单章 2600 字/)
  assert.match(card, /撞见城市另一面/)
  // 语言总是出现，所以只有语言时卡片仍有一格。
  assert.equal(proposalCard(parseProposal({ title: '书', summary: 's' })), '立项《书》｜中文\ns')
  assert.match(proposalCard(parseProposal({ title: 'book', summary: 's', language: 'en' })), /English/)
})

test('allowing the card writes work.json with the confirmed fields', async () => {
  const root = await workspace()
  try {
    const approval = fakeApproval('allowed-once')
    const { ctx, registered } = services(root, approval.service)
    installProposalTool(ctx)
    const result = await registered.get(PROPOSE_NAME).execute(full, exec)
    assert.equal(result.created, true)
    assert.equal(result.outcome, 'allowed-once')
    assert.match(result.work, /《夜班司机》/)
    assert.match(result.work, /目标 120 章/)

    const work = await readWork(root)
    assert.equal(work.title, '夜班司机')
    assert.equal(work.language, 'zh')
    assert.deepEqual(work.metadata, {
      targetChapters: 120,
      chapterWordCount: 2600,
      genre: '都市悬疑',
      platform: '起点',
    })
    assert.equal(await exists(join(root, 'source')), false, '立项不创建 source/')
    assert.equal(approval.requests.length, 1)
    assert.equal(approval.requests[0].callId, 'call_1')
    assert.equal(approval.requests[0].toolName, 'story_propose')
    assert.match(approval.requests[0].reason, /立项《夜班司机》/)
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
      assert.equal(result.work, null)
      assert.equal(await exists(join(root, 'work.json')), false)
      const rendered = registered.get(PROPOSE_NAME).output.render({}, result)
      assert.match(rendered[0].text, new RegExp(`未立项（${outcome}）`))
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

test('an existing work is refused without touching it', async () => {
  const root = await workspace()
  try {
    await writeWork(root, { title: '已经有的书' })
    const before = await readFile(join(root, 'work.json'), 'utf8')
    const approval = fakeApproval('allowed-once')
    const { ctx, registered } = services(root, approval.service)
    installProposalTool(ctx)
    await assert.rejects(registered.get(PROPOSE_NAME).execute(full, exec), /已经立项/)
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
