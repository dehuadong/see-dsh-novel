import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createBackup, listBackups, restoreBackup, formatStamp } from '../src/core/backup.ts'
import { installBackupCommand } from '../src/plugin/backup-command.ts'
import { WORK_FILE } from '../src/core/story-paths.ts'

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-backup-'))
  await mkdir(join(root, 'source/story/runtime'), { recursive: true })
  await writeFile(join(root, WORK_FILE), JSON.stringify({ id: 'w', title: '标题' }))
  await writeFile(join(root, 'source/story/current_state.md'), '# 当前状态\n\n甲在山上。\n')
  await writeFile(join(root, 'source/story/runtime/panel.index.json'), '{"stale":true}\n')
  await writeFile(join(root, 'source/.write.lock'), '{"token":"live"}\n')
  await writeFile(join(root, 'w.txt'), '旧导出')
  await writeFile(join(root, 'notes.md'), '作者笔记')
  await mkdir(join(root, '.git'), { recursive: true })
  await writeFile(join(root, '.git/config'), 'git config')
  return root
}

const at = (iso) => () => new Date(iso)

test('create copies the owned items and excludes lock, panel index, root files and backups', async () => {
  const root = await workspace()
  try {
    const first = await createBackup(root, { now: at('2026-11-10T08:12:33Z') })
    assert.equal(first.backupId, '20261110-081233')
    assert.equal(await readFile(join(first.path, WORK_FILE), 'utf8'), await readFile(join(root, WORK_FILE), 'utf8'))
    assert.match(await readFile(join(first.path, 'source/story/current_state.md'), 'utf8'), /甲在山上/)
    await assert.rejects(stat(join(first.path, 'source/.write.lock')), { code: 'ENOENT' })
    await assert.rejects(stat(join(first.path, 'source/story/runtime/panel.index.json')), { code: 'ENOENT' })
    await assert.rejects(stat(join(first.path, 'w.txt')), { code: 'ENOENT' })
    await assert.rejects(stat(join(first.path, 'notes.md')), { code: 'ENOENT' })
    await assert.rejects(stat(join(first.path, '.git')), { code: 'ENOENT' })
    await assert.rejects(stat(join(first.path, '.backups')), { code: 'ENOENT' })

    const second = await createBackup(root, { now: at('2026-11-10T08:12:33Z') })
    assert.equal(second.backupId, '20261110-081233-2')
    await assert.rejects(stat(join(second.path, '.backups')), { code: 'ENOENT' })
    assert.equal(formatStamp(new Date('2026-01-02T03:04:05Z')), '20260102-030405')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('list sorts newest first and an empty workspace has no backups', async () => {
  const root = await workspace()
  try {
    await createBackup(root, { now: at('2026-11-09T10:00:00Z') })
    await createBackup(root, { now: at('2026-11-10T10:00:00Z') })
    const backups = await listBackups(root)
    assert.deepEqual(backups.map((backup) => backup.id), ['20261110-100000', '20261109-100000'])
    const empty = await mkdtemp(join(tmpdir(), 'see-dsh-novel-backup-empty-'))
    try {
      assert.deepEqual(await listBackups(empty), [])
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('restore replaces work.json and source, keeps root files and the live lock', async () => {
  const root = await workspace()
  try {
    const backup = await createBackup(root, { now: at('2026-11-10T08:12:33Z') })
    await writeFile(join(root, 'source/story/current_state.md'), '# 当前状态\n\n改坏了。\n')
    await writeFile(join(root, 'source/story/extra.md'), '新增文件')
    await writeFile(join(root, 'w.txt'), '新导出')
    await mkdir(join(root, '.drafts'), { recursive: true })
    await writeFile(join(root, '.drafts/chapter-0001.md'), '# 第1章 雨夜\n\n草稿。\n')

    const result = await restoreBackup(root, backup.backupId, { now: at('2026-11-10T09:00:00Z') })
    assert.equal(result.restoredFrom, backup.backupId)
    assert.equal(result.preRestoreBackupId, '20261110-090000-pre-restore')
    assert.equal(result.isolatedTransactions, 0)

    assert.match(await readFile(join(root, 'source/story/current_state.md'), 'utf8'), /甲在山上/)
    await assert.rejects(stat(join(root, 'source/story/extra.md')), { code: 'ENOENT' })
    assert.equal(await readFile(join(root, 'w.txt'), 'utf8'), '新导出')
    assert.equal(await readFile(join(root, 'notes.md'), 'utf8'), '作者笔记')
    assert.equal(await readFile(join(root, '.git/config'), 'utf8'), 'git config')
    assert.equal(await readFile(join(root, 'source/.write.lock'), 'utf8'), '{"token":"live"}\n')
    assert.ok((await stat(join(root, '.backups', result.preRestoreBackupId))).isDirectory())
    assert.ok((await stat(join(root, '.backups', backup.backupId))).isDirectory())
    await assert.rejects(stat(join(root, '.drafts/chapter-0001.md')), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('backup and restore do not require a readable work.json', async () => {
  const root = await workspace()
  try {
    const backup = await createBackup(root, { now: at('2026-11-10T08:12:33Z') })
    await writeFile(join(root, WORK_FILE), '{ broken json')
    const again = await createBackup(root, { now: at('2026-11-10T08:13:00Z') })
    assert.equal(again.backupId, '20261110-081300')
    const restored = await restoreBackup(root, backup.backupId, { now: at('2026-11-10T09:00:00Z') })
    assert.equal(restored.preRestoreBackupId, '20261110-090000-pre-restore')
    assert.equal(await readFile(join(root, WORK_FILE), 'utf8'), await readFile(join(backup.path, WORK_FILE), 'utf8'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('restoring into an empty workspace has no pre-restore backup', async () => {
  const root = await workspace()
  try {
    const backup = await createBackup(root, { now: at('2026-11-10T08:12:33Z') })
    await rm(join(root, WORK_FILE), { force: true })
    await rm(join(root, 'source'), { recursive: true, force: true })
    await mkdir(join(root, 'source'), { recursive: true })
    await writeFile(join(root, 'source/.write.lock'), 'lock only')
    const result = await restoreBackup(root, backup.backupId)
    assert.equal(result.preRestoreBackupId, null)
    assert.match(await readFile(join(root, 'source/story/current_state.md'), 'utf8'), /甲在山上/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an unreadable transaction journal is isolated and restore still succeeds', async () => {
  const root = await workspace()
  try {
    const backup = await createBackup(root, { now: at('2026-11-10T08:12:33Z') })
    await mkdir(join(root, '.inkos-file-txn-bad'), { recursive: true })
    await writeFile(join(root, '.inkos-file-txn-bad/journal.json'), 'not json')
    const result = await restoreBackup(root, backup.backupId, { now: at('2026-11-10T09:00:00Z') })
    assert.equal(result.isolatedTransactions, 1)
    await assert.rejects(stat(join(root, '.inkos-file-txn-bad')), { code: 'ENOENT' })
    assert.ok((await stat(join(root, '.dead-txn-bad-0'))).isDirectory())
    assert.match(await readFile(join(root, 'source/story/current_state.md'), 'utf8'), /甲在山上/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('invalid and missing backup ids are rejected without touching the work', async () => {
  const root = await workspace()
  try {
    await assert.rejects(restoreBackup(root, '../x'), /备份 id 不合法/)
    await assert.rejects(restoreBackup(root, '..'), /备份 id 不合法/)
    await assert.rejects(restoreBackup(root, 'missing'), /找不到备份/)
    assert.equal(await readFile(join(root, 'notes.md'), 'utf8'), '作者笔记')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the command creates, lists and restores, and releases the work lock', async () => {
  const root = await workspace()
  await rm(join(root, 'source/.write.lock'), { force: true })
  const commands = new Map()
  const dispose = installBackupCommand({
    commands: { register: (definition) => { commands.set(definition.name, definition); return () => {} } },
    workingDirectory: { ensure: async () => root },
  })
  try {
    const command = commands.get('story-backup')
    const created = await command.handler({ rawInput: '', agent: { session: 's' } })
    assert.equal(created.kind, 'success')
    assert.match(created.text, /已创建备份/)

    const listed = await command.handler({ rawInput: 'list', agent: { session: 's' } })
    assert.equal(listed.kind, 'success')
    assert.match(listed.text, /备份（最新在前）/)

    const id = (await listBackups(root))[0].id
    const restored = await command.handler({ rawInput: `restore ${id}`, agent: { session: 's' } })
    assert.equal(restored.kind, 'success')
    assert.match(restored.text, /已从 .* 恢复/)

    const again = await command.handler({ rawInput: 'create', agent: { session: 's' } })
    assert.equal(again.kind, 'success')
  } finally {
    dispose()
    await rm(root, { recursive: true, force: true })
  }
})

test('the command rejects unknown actions, bad arity and extra tokens', async () => {
  const root = await workspace()
  await rm(join(root, 'source/.write.lock'), { force: true })
  const commands = new Map()
  const dispose = installBackupCommand({
    commands: { register: (definition) => { commands.set(definition.name, definition); return () => {} } },
    workingDirectory: { ensure: async () => root },
  })
  try {
    const command = commands.get('story-backup')
    const cases = [
      ['restore', /用法/],
      ['restore a b', /用法/],
      ['list foo', /用法/],
      ['create foo', /用法/],
      ['wat', /未知子命令/],
    ]
    for (const [input, pattern] of cases) {
      const result = await command.handler({ rawInput: input, agent: { session: 's' } })
      assert.equal(result.kind, 'error', input)
      assert.match(result.text, pattern, input)
    }
    const bad = await command.handler({ rawInput: 'restore ..', agent: { session: 's' } })
    assert.equal(bad.kind, 'error')
    assert.match(bad.text, /备份 id 不合法/)
  } finally {
    dispose()
    await rm(root, { recursive: true, force: true })
  }
})
