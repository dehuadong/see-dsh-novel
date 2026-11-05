import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { commitFile, commitFoundation } from '../src/core/commit.ts'
import { readArtifacts } from '../src/core/artifacts.ts'
import { defaultStateFiles, stateWritesIfMissing } from '../src/core/state.ts'
import {
  parseJournal,
  pidAlive,
  repairWorkspace,
  scanWorkspace,
} from '../src/core/recovery.ts'
import { installRecoveryTool, RECOVER_NAME, recoverOutput, recoverParameters } from '../src/plugin/recovery-tool.ts'
import { approvalMarkerLine } from '../src/core/receipts.ts'
import { writeWork } from '../src/core/work.ts'
import { violations } from './support/schema-subset.mjs'

/** 一个空的临时工作区。 */
async function workspace() {
  return mkdtemp(join(tmpdir(), 'see-dsh-novel-recovery-'))
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

/** 一个没有子代理的假 ctx：只提供工作目录。 */
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

/** 播种一份基础设定（三个索引 + 大纲），返回摘要。 */
async function seedFoundation(root) {
  const writes = defaultStateFiles([]).filter((write) => !write.relativePath.endsWith('hooks.json'))
  writes.push({ relativePath: 'source/story/outline/story_frame.md', content: '# 大纲\n' })
  await commitFoundation(root, { writes })
  return (await readArtifacts(root)).digest
}

const DEAD_PID = 999999

/** 造一个残留的暂存目录；`phase` 决定回收规则，`pending` 表示还有没搬走的 staged 文件。 */
async function stagingFixture(root, {
  phase,
  journal = true,
  pid = DEAD_PID,
  writes = ['source/story/outline/story_frame.md'],
  pending = true,
}) {
  const dir = join(root, 'source', '.staging-fixture')
  await mkdir(join(dir, 'backup', 'source/story/outline'), { recursive: true })
  await mkdir(join(dir, 'work'), { recursive: true })
  if (pending && writes.length > 0) await writeFile(join(dir, 'work', 'staged.md'), 'staged\n', 'utf8')
  if (journal) {
    await writeFile(join(dir, 'journal.json'), JSON.stringify({ version: 1, pid, phase, writes, deletes: [] }), 'utf8')
  }
  return dir
}

test('an empty workspace is unbound and apply writes nothing', async () => {
  const root = await workspace()
  try {
    const scan = await scanWorkspace(root)
    assert.deepEqual(scan.findings.map((finding) => finding.code), ['unbound'])
    assert.equal(scan.findings[0].fixable, false)

    const applied = await repairWorkspace(root, scan.findings)
    assert.deepEqual(applied, [])
    assert.deepEqual(await readdir(root), [])
  } finally {
    await cleanup(root)
  }
})

test('an empty source/story directory is unbound', async () => {
  const root = await workspace()
  try {
    await mkdir(join(root, 'source/story'), { recursive: true })
    const scan = await scanWorkspace(root)
    assert.deepEqual(scan.findings.map((finding) => finding.code), ['unbound'])
  } finally {
    await cleanup(root)
  }
})

test('missing indexes are reported even when work.json is broken', async () => {
  const root = await workspace()
  try {
    await seedFoundation(root)
    await rm(join(root, 'source/story/state/manifest.json'))
    await writeFile(join(root, 'work.json'), '{ not json', 'utf8')
    const scan = await scanWorkspace(root)
    const codes = scan.findings.map((finding) => finding.code)
    assert.ok(codes.includes('work-invalid'))
    assert.equal(codes.filter((code) => code === 'state-missing').length, 1)
    const applied = await repairWorkspace(root, scan.findings)
    assert.deepEqual(applied, ['source/story/state/manifest.json'])
    assert.equal(await exists(join(root, 'work.json')), true)
    assert.equal((await readFile(join(root, 'work.json'), 'utf8')), '{ not json', '身份不被改写')
  } finally {
    await cleanup(root)
  }
})

test('a work.json-only workspace reports an empty foundation and writes nothing', async () => {
  const root = await workspace()
  try {
    await writeWork(root, { title: '空' })
    const scan = await scanWorkspace(root)
    assert.deepEqual(scan.findings.map((finding) => finding.code), ['foundation-empty'])
    assert.deepEqual(await repairWorkspace(root, scan.findings), [])
  } finally {
    await cleanup(root)
  }
})

test('content without work.json is reported, never invented', async () => {
  const root = await workspace()
  try {
    await seedFoundation(root)
    const scan = await scanWorkspace(root)
    const codes = scan.findings.map((finding) => finding.code)
    assert.ok(codes.includes('work-missing'))
    assert.equal(scan.findings.find((finding) => finding.code === 'work-missing').fixable, false)
    await repairWorkspace(root, scan.findings)
    assert.equal(await exists(join(root, 'work.json')), false)
  } finally {
    await cleanup(root)
  }
})

test('a broken work.json is reported and never rewritten', async () => {
  const root = await workspace()
  try {
    await writeFile(join(root, 'work.json'), '{ not json', 'utf8')
    const scan = await scanWorkspace(root)
    assert.deepEqual(scan.findings.map((finding) => finding.code), ['work-invalid'])
    assert.equal(scan.findings[0].severity, 'error')
    await repairWorkspace(root, scan.findings)
    assert.equal(await readFile(join(root, 'work.json'), 'utf8'), '{ not json')
  } finally {
    await cleanup(root)
  }
})

test('each missing index is rebuilt byte-identically and the digest returns', async () => {
  for (const name of ['manifest.json', 'current_state.json', 'chapter_summaries.json']) {
    const root = await workspace()
    try {
      await writeWork(root, { title: '索引' })
      const original = await seedFoundation(root)
      const path = join(root, 'source/story/state', name)
      await rm(path)
      const scan = await scanWorkspace(root)
      const finding = scan.findings.find((entry) => entry.code === 'state-missing')
      assert.ok(finding, name)
      assert.equal(finding.path, `source/story/state/${name}`)
      assert.notEqual(scan.digest, original)

      const applied = await repairWorkspace(root, scan.findings)
      assert.deepEqual(applied, [`source/story/state/${name}`])
      const expected = defaultStateFiles([]).find((write) => write.relativePath === `source/story/state/${name}`)
      assert.equal(await readFile(path, 'utf8'), expected.content)
      assert.equal((await readArtifacts(root)).digest, original, '内容一致时摘要回到原值')
      const rescan = await scanWorkspace(root)
      assert.equal(rescan.findings.some((entry) => entry.code === 'state-missing'), false)
      assert.equal(await exists(join(root, 'source/story/state/hooks.json')), false, '不创建 hooks')
    } finally {
      await cleanup(root)
    }
  }
})

test('a missing hooks pool is reported but never rebuilt', async () => {
  const root = await workspace()
  try {
    await writeWork(root, { title: '伏笔' })
    await seedFoundation(root)
    const scan = await scanWorkspace(root)
    const hooks = scan.findings.find((entry) => entry.code === 'hooks-missing')
    assert.ok(hooks)
    assert.equal(hooks.fixable, false)
    await repairWorkspace(root, scan.findings)
    assert.equal(await exists(join(root, 'source/story/state/hooks.json')), false)
  } finally {
    await cleanup(root)
  }
})

test('a dead prepared staging is rolled back from its backup', async () => {
  const root = await workspace()
  try {
    await seedFoundation(root)
    const target = join(root, 'source/story/outline/story_frame.md')
    const original = await readFile(target, 'utf8')
    const staging = await stagingFixture(root, { phase: 'prepared' })
    await writeFile(join(staging, 'backup/source/story/outline/story_frame.md'), original, 'utf8')
    await writeFile(target, '# 半套新大纲\n', 'utf8')

    const scan = await scanWorkspace(root)
    const finding = scan.findings.find((entry) => entry.code === 'staging-rollback')
    assert.ok(finding)
    assert.equal(finding.fixable, true)

    const applied = await repairWorkspace(root, scan.findings)
    assert.deepEqual(applied, ['source/.staging-fixture'])
    assert.equal(await readFile(target, 'utf8'), original)
    assert.equal(await exists(staging), false)
  } finally {
    await cleanup(root)
  }
})

test('a prepared staging whose files were all moved is cleaned, not rolled back', async () => {
  const root = await workspace()
  try {
    await seedFoundation(root)
    const target = join(root, 'source/story/outline/story_frame.md')
    const applied = '# 已应用\n'
    await writeFile(target, applied, 'utf8')
    // 日志停在 prepared（applied 标记没写成），但 work/ 已经空了：rename 全做完了。
    const staging = await stagingFixture(root, { phase: 'prepared', pending: false })
    await writeFile(join(staging, 'backup/source/story/outline/story_frame.md'), '# 旧大纲\n', 'utf8')

    const scan = await scanWorkspace(root)
    assert.ok(scan.findings.some((entry) => entry.code === 'staging-cleanup'))
    assert.equal(scan.findings.some((entry) => entry.code === 'staging-rollback'), false)

    await repairWorkspace(root, scan.findings)
    assert.equal(await readFile(target, 'utf8'), applied, '已应用的文件不被回滚')
    assert.equal(await exists(staging), false)
  } finally {
    await cleanup(root)
  }
})

test('a dead applied staging is only cleaned up', async () => {
  const root = await workspace()
  try {
    await seedFoundation(root)
    const target = join(root, 'source/story/outline/story_frame.md')
    const staging = await stagingFixture(root, { phase: 'applied' })
    await writeFile(target, '# 已应用\n', 'utf8')

    const scan = await scanWorkspace(root)
    assert.ok(scan.findings.some((entry) => entry.code === 'staging-cleanup'))
    await repairWorkspace(root, scan.findings)
    assert.equal(await readFile(target, 'utf8'), '# 已应用\n')
    assert.equal(await exists(staging), false)
  } finally {
    await cleanup(root)
  }
})

test('a live staging is left alone', async () => {
  const root = await workspace()
  try {
    await seedFoundation(root)
    const staging = await stagingFixture(root, { phase: 'prepared', pid: process.pid })
    const scan = await scanWorkspace(root)
    assert.ok(scan.findings.some((entry) => entry.code === 'staging-active'))
    await repairWorkspace(root, scan.findings)
    assert.equal(await exists(staging), true)
  } finally {
    await cleanup(root)
  }
})

test('a staging without a readable journal is reported only', async () => {
  const root = await workspace()
  try {
    await seedFoundation(root)
    const staging = await stagingFixture(root, { phase: 'prepared', journal: false })
    const scan = await scanWorkspace(root)
    assert.ok(scan.findings.some((entry) => entry.code === 'staging-unknown'))
    // 读了一半的日志同样只报告。
    await writeFile(join(staging, 'journal.json'), '{"version":1,"pid":', 'utf8')
    const torn = await scanWorkspace(root)
    assert.ok(torn.findings.some((entry) => entry.code === 'staging-unknown'))
    await repairWorkspace(root, scan.findings)
    assert.equal(await exists(staging), true)
  } finally {
    await cleanup(root)
  }
})

test('a staging with an unreadable journal (not just a torn one) is reported only', async () => {
  const root = await workspace()
  try {
    await seedFoundation(root)
    const staging = await stagingFixture(root, { phase: 'prepared', journal: false })
    // 日志位置被一个目录占住：readFile 抛 EISDIR，不是 ENOENT。
    await mkdir(join(staging, 'journal.json'), { recursive: true })
    const scan = await scanWorkspace(root)
    assert.ok(scan.findings.some((entry) => entry.code === 'staging-unknown'))
    await repairWorkspace(root, scan.findings)
    assert.equal(await exists(staging), true)
  } finally {
    await cleanup(root)
  }
})

test('temp files are removed only when their owner is dead', async () => {
  const root = await workspace()
  try {
    const dead = join(root, `.tmp-${DEAD_PID}-dead`)
    const live = join(root, `.tmp-${process.pid}-live`)
    const legacy = join(root, '.tmp-legacy')
    await writeFile(dead, 'x', 'utf8')
    await writeFile(live, 'x', 'utf8')
    await writeFile(legacy, 'x', 'utf8')

    const scan = await scanWorkspace(root)
    const residues = scan.findings.filter((entry) => entry.code === 'tmp-residue')
    assert.equal(residues.length, 3)
    assert.equal(residues.find((entry) => entry.path === `.tmp-${DEAD_PID}-dead`).fixable, true)
    assert.equal(residues.find((entry) => entry.path === `.tmp-${process.pid}-live`).fixable, false)
    assert.equal(residues.find((entry) => entry.path === '.tmp-legacy').fixable, false)

    await repairWorkspace(root, scan.findings)
    assert.equal(await exists(dead), false)
    assert.equal(await exists(live), true)
    assert.equal(await exists(legacy), true)
  } finally {
    await cleanup(root)
  }
})

test('journal parsing rejects torn or unknown shapes', () => {
  assert.equal(parseJournal('{"version":1,"pid":1,'), undefined)
  assert.equal(parseJournal(JSON.stringify({ version: 2, pid: 1, phase: 'prepared', writes: [], deletes: [] })), undefined)
  assert.equal(parseJournal(JSON.stringify({ version: 1, pid: 1, phase: 'later', writes: [], deletes: [] })), undefined)
  assert.ok(parseJournal(JSON.stringify({ version: 1, pid: 1, phase: 'prepared', writes: [], deletes: [] })))
  assert.equal(pidAlive(DEAD_PID), false)
  assert.equal(pidAlive(process.pid), true)
})

test('a commit leaves no staging and writes a readable journal while running', async () => {
  const root = await workspace()
  try {
    await commitFoundation(root, { writes: [{ relativePath: 'source/story/outline/a.md', content: 'a\n' }] })
    assert.equal(await exists(join(root, 'source/.staging-fixture')), false)
    const entries = await readdir(join(root, 'source'))
    assert.equal(entries.some((name) => name.startsWith('.staging-')), false, '提交结束后不留暂存目录')

    // 回滚路径也不留目录：让 rename 失败（目标目录不可建）看它清理。
    await writeFile(join(root, 'blocked'), 'x', 'utf8')
    await assert.rejects(commitFoundation(root, { writes: [{ relativePath: 'blocked/a.md', content: 'a\n' }] }))
    assert.equal((await readdir(join(root, 'source'))).some((name) => name.startsWith('.staging-')), false)
  } finally {
    await cleanup(root)
  }
})

test('the tool scans, applies and reports whether reconfirmation is needed', async () => {
  const root = await workspace()
  try {
    const { ctx, registered } = services(root)
    const dispose = installRecoveryTool(ctx)
    assert.deepEqual([...registered.keys()], [RECOVER_NAME])

    await writeWork(root, { title: '工具' })
    const digest = await seedFoundation(root)
    await rm(join(root, 'source/story/state/manifest.json'))

    // 作者认可过旧摘要：修复后的摘要与它不一致，需要重新确认。
    const events = [
      { type: 'command/run', seq: 1, time: 1, data: { commandId: 'c1', name: 'story-approve' } },
      {
        type: 'command/done',
        seq: 2,
        time: 2,
        data: { commandId: 'c1', kind: 'success', text: approvalMarkerLine('foundation', 'f'.repeat(64), 4, 'receipt') },
      },
    ]
    const exec = { agent: { session: { id: 'session-root', snapshotEvents: () => events } } }
    const result = await registered.get(RECOVER_NAME).execute({ apply: true }, exec)
    assert.ok(result.applied.includes('source/story/state/manifest.json'))
    assert.equal(result.digestAfter, digest)
    assert.equal(result.approvedDigest, 'f'.repeat(64))
    assert.equal(result.needsReconfirm, true)
    // 报告讲的是修复前发现的问题，修完之后不会「什么都没发现」。
    assert.ok(result.findings.some((finding) => finding.code === 'state-missing'))

    const rendered = registered.get(RECOVER_NAME).output.render({}, result)
    assert.match(rendered[0].text, /已修复 1 项/)
    assert.match(rendered[0].text, /需要重新确认/)
    dispose()
  } finally {
    await cleanup(root)
  }
})

test('reconfirm is false when the rebuilt digest matches the approved one', async () => {
  const root = await workspace()
  try {
    await writeWork(root, { title: '一致' })
    const digest = await seedFoundation(root)
    await rm(join(root, 'source/story/state/manifest.json'))
    const events = [
      { type: 'command/run', seq: 1, time: 1, data: { commandId: 'c1', name: 'story-approve' } },
      {
        type: 'command/done',
        seq: 2,
        time: 2,
        data: { commandId: 'c1', kind: 'success', text: approvalMarkerLine('foundation', digest, 4, 'receipt') },
      },
    ]
    const { ctx, registered } = services(root)
    installRecoveryTool(ctx)
    const exec = { agent: { session: { id: 'session-root', snapshotEvents: () => events } } }
    const result = await registered.get(RECOVER_NAME).execute({ apply: true }, exec)
    assert.equal(result.needsReconfirm, false)
    const rendered = registered.get(RECOVER_NAME).output.render({}, result)
    assert.doesNotMatch(rendered[0].text, /需要重新确认/)
  } finally {
    await cleanup(root)
  }
})

test('the tool reports no findings on a healthy workspace', async () => {
  const root = await workspace()
  try {
    await writeWork(root, { title: '健康' })
    await seedFoundation(root)
    await writeFile(join(root, 'source/story/state/hooks.json'), '{"hooks":[]}\n', 'utf8')
    const { ctx, registered } = services(root)
    installRecoveryTool(ctx)
    const exec = { agent: { session: { id: 'session-root', snapshotEvents: () => [] } } }
    const result = await registered.get(RECOVER_NAME).execute({}, exec)
    assert.deepEqual(result.findings, [])
    assert.deepEqual(result.applied, [])
    assert.equal(result.approvedDigest, null)
    assert.equal(result.needsReconfirm, false)
    const rendered = registered.get(RECOVER_NAME).output.render({}, result)
    assert.match(rendered[0].text, /自检通过/)
  } finally {
    await cleanup(root)
  }
})

test('the tool report stays inside the declared output shape', async () => {
  const root = await workspace()
  try {
    await seedFoundation(root)
    const staging = await stagingFixture(root, { phase: 'prepared' })
    await writeFile(join(root, `.tmp-${DEAD_PID}-x`), 'x', 'utf8')
    const { ctx, registered } = services(root)
    installRecoveryTool(ctx)
    const exec = { agent: { session: { id: 'session-root', snapshotEvents: () => [] } } }
    const result = await registered.get(RECOVER_NAME).execute({}, exec)
    void staging
    for (const finding of result.findings) {
      // 输出 schema 是 additionalProperties: false；多一个字段运行时就会拒绝。
      assert.deepEqual(Object.keys(finding).sort(), ['code', 'detail', 'fixable', 'path', 'severity'])
    }
  } finally {
    await cleanup(root)
  }
})

test('stateWritesIfMissing seeds only what is absent and shares the defaults', async () => {
  const root = await workspace()
  try {
    const writes = await stateWritesIfMissing(root, [])
    assert.deepEqual(writes.map((write) => write.relativePath).sort(), [
      'source/story/state/chapter_summaries.json',
      'source/story/state/current_state.json',
      'source/story/state/hooks.json',
      'source/story/state/manifest.json',
    ])
    await commitFoundation(root, { writes })
    assert.deepEqual(await stateWritesIfMissing(root, []), [])
    const expected = defaultStateFiles([]).find((write) => write.relativePath.endsWith('manifest.json'))
    assert.equal(await readFile(join(root, 'source/story/state/manifest.json'), 'utf8'), expected.content)
  } finally {
    await cleanup(root)
  }
})

test('the schemas stay inside the runtime subset', () => {
  assert.deepEqual(violations(recoverParameters), [])
  assert.deepEqual(violations(recoverOutput), [])
})
