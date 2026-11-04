import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { readArtifacts } from '../src/core/artifacts.ts'
import { approvalMarkerLine } from '../src/core/receipts.ts'
import { installApprovalCommands } from '../src/pipelines/long/commands.ts'
import { evaluateSignoff, installGateTools } from '../src/pipelines/long/gate.ts'

const FRAME = 'source/story/outline/story_frame.md'
const MAP = 'source/story/outline/volume_map.md'

/** 一根只有基础设定的作品。 */
async function work(files = { [FRAME]: '框架\n', [MAP]: '卷图\n' }) {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-approval-'))
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content, 'utf8')
  }
  return root
}

/** 删除临时作品根。 */
const workCleanup = (root) => rm(root, { recursive: true, force: true })

let seq = 0
/** 一条命令的 run/done 对，模拟运行时写进会话日志的形态。 */
function commandEvents(name, text, kind = 'success') {
  const commandId = `cmd-${++seq}`
  return [
    { type: 'command/run', seq: seq++, time: Date.now(), data: { commandId, name, args: '', source: { kind: 'user' } } },
    { type: 'command/done', seq: seq++, time: Date.now(), data: { commandId, kind, ...text === undefined ? {} : { text } } },
  ]
}

/** 一条成功的 /story-approve 回执。 */
function approvalEvents(artifacts) {
  return commandEvents(
    'story-approve',
    `作者确认 foundation：${artifacts.files.length} 个文件\n`
      + approvalMarkerLine('foundation', artifacts.digest, artifacts.files.length, 'receipt'),
  )
}

/** 一次通过原生确认条完成的签核留在日志里的形态。 */
function nativeSignoffEvents(artifacts) {
  const callId = `call-${++seq}`
  return [
    { type: 'tool/call', seq: seq++, time: Date.now(), data: { turn: 1, step: 1, callId, name: 'story_foundation_signoff', arguments: '{}' } },
    {
      type: 'tool/result',
      seq: seq++,
      time: Date.now(),
      data: {
        turn: 1,
        step: 1,
        message: {
          role: 'tool',
          toolCallId: callId,
          content: [{
            type: 'text',
            text: '已定稿 foundation\n'
              + approvalMarkerLine('foundation', artifacts.digest, artifacts.files.length, 'approval'),
          }],
        },
      },
    },
  ]
}

const agentWith = (events) => ({ session: { snapshotEvents: () => events } })

/** approval 服务替身；`request` 被调用时记下来。 */
function approvalStub({ policy = 'ask', outcome = 'allowed-once', seen = [] } = {}) {
  return {
    seen,
    overrideOf: () => policy,
    request: async (request) => {
      seen.push(request)
      return outcome
    },
  }
}

test('the digest tracks content, not just the file set', async () => {
  const root = await work()
  try {
    const first = await readArtifacts(root)
    assert.deepEqual(first.files, [FRAME, MAP])
    assert.match(first.digest, /^[0-9a-f]{64}$/)

    const again = await readArtifacts(root)
    assert.equal(again.digest, first.digest)

    await writeFile(join(root, MAP), '卷图改过\n', 'utf8')
    const changed = await readArtifacts(root)
    assert.deepEqual(changed.files, first.files)
    assert.notEqual(changed.digest, first.digest)
  } finally {
    await workCleanup(root)
  }
})

test('an empty work has no digest and refuses to be signed off', async () => {
  const root = await work({})
  try {
    const artifacts = await readArtifacts(root)
    assert.deepEqual(artifacts.files, [])
    assert.equal(artifacts.digest, '')

    const result = await evaluateSignoff({
      root,
      agent: agentWith([]),
      approval: approvalStub(),
    })
    assert.equal(result.kind, 'denied')
    assert.equal(result.reason, 'no-artifacts')
  } finally {
    await workCleanup(root)
  }
})

test('a never policy never reaches the approval prompt and points at the panel', async () => {
  const root = await work()
  const approval = approvalStub({ policy: 'never' })
  try {
    const before = await readArtifacts(root)
    const result = await evaluateSignoff({ root, agent: agentWith([]), approval })
    assert.equal(result.kind, 'denied')
    assert.equal(result.reason, 'policy-never')
    assert.equal(approval.seen.length, 0)
    assert.match(result.message, /\/story-approve/)
    assert.match(result.message, /never/)
    // 拒绝不写盘：内容与摘要都没动。
    assert.equal((await readArtifacts(root)).digest, before.digest)
  } finally {
    await workCleanup(root)
  }
})

test('a missing approval service refuses and points at the panel', async () => {
  const root = await work()
  try {
    const result = await evaluateSignoff({ root, agent: agentWith([]), approval: undefined })
    assert.equal(result.kind, 'denied')
    assert.equal(result.reason, 'no-approval-service')
    assert.match(result.message, /\/story-approve/)
  } finally {
    await workCleanup(root)
  }
})

test('an ask policy prompts and signs on allowed-once', async () => {
  const root = await work()
  const approval = approvalStub({ outcome: 'allowed-once' })
  try {
    const result = await evaluateSignoff({
      root,
      agent: agentWith([]),
      approval,
      callId: 'call-1',
      signal: new AbortController().signal,
    })
    assert.equal(result.kind, 'signed')
    assert.equal(result.channel, 'approval')
    assert.equal(approval.seen.length, 1)
    const request = approval.seen[0]
    assert.equal(request.toolName, 'story_foundation_signoff')
    assert.equal(request.callId, 'call-1')
    assert.match(request.reason, /2 个文件/)
    assert.match(request.reason, /story_frame\.md/)
  } finally {
    await workCleanup(root)
  }
})

test('a session without an override falls back to the composed default policy', async () => {
  const root = await work()
  const seen = []
  const approval = {
    config: { policy: 'ask' },
    overrideOf: () => undefined,
    request: async (request) => {
      seen.push(request)
      return 'allowed-once'
    },
  }
  try {
    const result = await evaluateSignoff({ root, agent: agentWith([]), approval })
    assert.equal(result.kind, 'signed')
    assert.equal(seen.length, 1)
  } finally {
    await workCleanup(root)
  }
})

test('a rejection stops here and does not point at the panel', async () => {
  const root = await work()
  try {
    const result = await evaluateSignoff({
      root,
      agent: agentWith([]),
      approval: approvalStub({ outcome: 'rejected' }),
    })
    assert.equal(result.kind, 'denied')
    assert.equal(result.reason, 'rejected')
    assert.doesNotMatch(result.message, /\/story-approve/)
    assert.match(result.message, /退回/)
  } finally {
    await workCleanup(root)
  }
})

test('cancelled and unavailable deny with their own reasons', async () => {
  const root = await work()
  try {
    const cancelled = await evaluateSignoff({
      root,
      agent: agentWith([]),
      approval: approvalStub({ outcome: 'cancelled' }),
    })
    assert.equal(cancelled.reason, 'cancelled')

    const unavailable = await evaluateSignoff({
      root,
      agent: agentWith([]),
      approval: approvalStub({ outcome: 'unavailable' }),
    })
    assert.equal(unavailable.reason, 'unavailable')
    assert.match(unavailable.message, /\/story-approve/)
  } finally {
    await workCleanup(root)
  }
})

test('a work that changes while the author is deciding voids the confirmation', async () => {
  const root = await work()
  const approval = {
    overrideOf: () => 'ask',
    request: async () => {
      await writeFile(join(root, MAP), '卷图又改了\n', 'utf8')
      return 'allowed-once'
    },
  }
  try {
    const result = await evaluateSignoff({ root, agent: agentWith([]), approval })
    assert.equal(result.kind, 'denied')
    assert.equal(result.reason, 'changed')
  } finally {
    await workCleanup(root)
  }
})

test('a matching panel receipt signs without asking', async () => {
  const root = await work()
  const artifacts = await readArtifacts(root)
  const approval = approvalStub()
  try {
    const result = await evaluateSignoff({
      root,
      agent: agentWith(approvalEvents(artifacts)),
      approval,
    })
    assert.equal(result.kind, 'signed')
    assert.equal(result.channel, 'receipt')
    assert.equal(approval.seen.length, 0)
  } finally {
    await workCleanup(root)
  }
})

test('a receipt goes stale when the work changes under it', async () => {
  const root = await work()
  const artifacts = await readArtifacts(root)
  try {
    await writeFile(join(root, FRAME), '框架改过\n', 'utf8')
    const result = await evaluateSignoff({
      root,
      agent: agentWith(approvalEvents(artifacts)),
      approval: approvalStub({ outcome: 'rejected' }),
    })
    assert.equal(result.kind, 'denied')
    assert.equal(result.reason, 'rejected')
  } finally {
    await workCleanup(root)
  }
})

test('a receipt for another stage does not count', async () => {
  const root = await work()
  const artifacts = await readArtifacts(root)
  const events = commandEvents(
    'story-approve',
    approvalMarkerLine('chapter', artifacts.digest, artifacts.files.length, 'receipt'),
  )
  try {
    const result = await evaluateSignoff({
      root,
      agent: agentWith(events),
      approval: approvalStub({ policy: 'never' }),
    })
    assert.equal(result.reason, 'policy-never')
  } finally {
    await workCleanup(root)
  }
})

test('a rejection after an approval voids the earlier receipt', async () => {
  const root = await work()
  const artifacts = await readArtifacts(root)
  const events = [
    ...approvalEvents(artifacts),
    ...commandEvents('story-reject', '作者退回 foundation\n退回会作废之前的确认'),
  ]
  const approval = approvalStub({ outcome: 'rejected' })
  try {
    const result = await evaluateSignoff({ root, agent: agentWith(events), approval })
    assert.equal(result.kind, 'denied')
    assert.equal(result.reason, 'rejected')
    assert.equal(approval.seen.length, 1)
  } finally {
    await workCleanup(root)
  }
})

test('a native signoff in the log counts as a confirmation', async () => {
  const root = await work()
  const artifacts = await readArtifacts(root)
  const approval = approvalStub()
  approval.request = async () => {
    throw new Error('a version already signed through the prompt must not be asked again')
  }
  try {
    const result = await evaluateSignoff({ root, agent: agentWith(nativeSignoffEvents(artifacts)), approval })
    assert.equal(result.kind, 'signed')
    assert.equal(result.channel, 'approval')
  } finally {
    await workCleanup(root)
  }
})

/** 注册工具与命令的替身宿主。 */
function host({ root, events = [], policy = 'never' }) {
  const registered = new Map()
  const approval = approvalStub({ policy })
  const ctx = {
    tools: {
      register(definition) {
        registered.set(definition.name, definition)
        return () => registered.delete(definition.name)
      },
    },
    workingDirectory: { ensure: async () => root },
    commands: {
      register(definition) {
        registered.set(`/${definition.name}`, definition)
        return () => registered.delete(`/${definition.name}`)
      },
    },
    get: (service) => service === 'approval' ? approval : undefined,
  }
  const disposeTools = installGateTools(ctx)
  const disposeCommands = installApprovalCommands(ctx)
  return {
    registered,
    approval,
    agent: agentWith(events),
    dispose() {
      disposeCommands()
      disposeTools()
    },
  }
}

test('/story-review lists the work and the review state', async () => {
  const root = await work()
  const { registered, agent, dispose } = host({ root })
  try {
    const result = await registered.get('/story-review').handler({ agent, rawInput: '', signal: new AbortController().signal })
    assert.equal(result.kind, 'success')
    assert.match(result.text, /2 个文件/)
    assert.match(result.text, /- source\/story\/outline\/story_frame\.md/)
    assert.match(result.text, /最近决定：无/)
    assert.match(result.text, /确认策略：never/)
    assert.match(result.text, /弹不出原生确认条/)
  } finally {
    dispose()
    await workCleanup(root)
  }
})

test('/story-approve writes the marker and records the note', async () => {
  const root = await work()
  const { registered, agent, dispose } = host({ root })
  try {
    const result = await registered.get('/story-approve').handler({ agent, rawInput: '这版可以', signal: new AbortController().signal })
    assert.equal(result.kind, 'success')
    assert.match(result.text, /作者备注：这版可以/)
    const artifacts = await readArtifacts(root)
    assert.match(result.text, new RegExp(`story-approval stage=foundation digest=${artifacts.digest} files=2`))
  } finally {
    dispose()
    await workCleanup(root)
  }
})

test('/story-approve refuses an empty work', async () => {
  const root = await work({})
  const { registered, agent, dispose } = host({ root })
  try {
    const result = await registered.get('/story-approve').handler({ agent, rawInput: '', signal: new AbortController().signal })
    assert.equal(result.kind, 'error')
    assert.doesNotMatch(result.text, /story-approval/)
  } finally {
    dispose()
    await workCleanup(root)
  }
})

test('/story-reject records a rejection without a marker', async () => {
  const root = await work()
  const { registered, agent, dispose } = host({ root })
  try {
    const result = await registered.get('/story-reject').handler({ agent, rawInput: '', signal: new AbortController().signal })
    assert.equal(result.kind, 'success')
    assert.match(result.text, /作者退回/)
    assert.doesNotMatch(result.text, /story-approval/)
  } finally {
    dispose()
    await workCleanup(root)
  }
})

test('the gate reports a confirmed version and the signoff tool signs it', async () => {
  const root = await work()
  const artifacts = await readArtifacts(root)
  const { registered, agent, dispose } = host({ root, events: approvalEvents(artifacts), policy: 'ask' })
  try {
    const gate = await registered.get('story_gate').execute({}, { agent })
    assert.equal(gate.stage, 'foundation')
    assert.equal(gate.files.length, 2)
    assert.equal(gate.digest, artifacts.digest)
    assert.equal(gate.confirmed, true)
    assert.equal(gate.decision, 'approve')
    assert.equal(gate.channel, 'receipt')
    assert.equal(gate.policy, 'ask')
    assert.equal(gate.canPrompt, true)

    const signed = await registered.get('story_foundation_signoff').execute({}, { agent })
    assert.deepEqual(signed, {
      signed: true,
      channel: 'receipt',
      digest: artifacts.digest,
      files: artifacts.files,
    })

    // 签核结果自带标记行，事后能读懂「这一版已签核」。
    const rendered = registered.get('story_foundation_signoff').output.render({}, signed)
    assert.match(rendered[0].text, new RegExp(`story-approval stage=foundation digest=${artifacts.digest} files=2 via=receipt`))
  } finally {
    dispose()
    await workCleanup(root)
  }
})

test('the signoff tool fails loud when the confirmation is missing', async () => {
  const root = await work()
  const { registered, agent, dispose } = host({ root, policy: 'never' })
  try {
    await assert.rejects(
      registered.get('story_foundation_signoff').execute({}, { agent }),
      /确认策略是 never/,
    )
    const gate = await registered.get('story_gate').execute({}, { agent })
    assert.equal(gate.confirmed, false)
    assert.match(gate.hint, /\/story-approve/)
  } finally {
    dispose()
    await workCleanup(root)
  }
})

test('the gate reports a rejection instead of hiding it', async () => {
  const root = await work()
  const artifacts = await readArtifacts(root)
  const events = [
    ...approvalEvents(artifacts),
    ...commandEvents('story-reject', '作者退回 foundation'),
  ]
  const { registered, agent, dispose } = host({ root, events, policy: 'never' })
  try {
    const gate = await registered.get('story_gate').execute({}, { agent })
    assert.equal(gate.confirmed, false)
    assert.equal(gate.decision, 'reject')
    assert.equal(gate.channel, 'none')
    assert.match(gate.hint, /退回/)

    await assert.rejects(
      registered.get('story_foundation_signoff').execute({}, { agent }),
      /确认策略是 never/,
    )
  } finally {
    dispose()
    await workCleanup(root)
  }
})

test('the gate tools refuse an execution without an owning agent', async () => {
  const root = await work()
  const { registered, dispose } = host({ root })
  try {
    await assert.rejects(registered.get('story_gate').execute({}, {}), /所属 agent/)
    await assert.rejects(registered.get('story_foundation_signoff').execute({}, {}), /所属 agent/)
  } finally {
    dispose()
    await workCleanup(root)
  }
})
