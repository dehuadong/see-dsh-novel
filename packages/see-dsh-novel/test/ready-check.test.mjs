import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  STORY_FRAME_FILE,
  STORY_PENDING_HOOKS,
  STORY_RULES_JSON,
  STORY_RULES_MD,
  STORY_VOLUME_MAP_FILE,
  workProbes,
  writeWork,
} from '../src/core/work.ts'
import { CAST_INDEX_STEP, NEXT_STEPS, storyNext } from '../src/plugin/story-next.ts'

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-ready-'))
  await mkdir(join(root, 'source/story/outline'), { recursive: true })
  return root
}

const cleanup = (root) => rm(root, { recursive: true, force: true })

async function seedFiles(root) {
  await writeFile(join(root, STORY_FRAME_FILE), '# 大纲\n', 'utf8')
  await writeFile(join(root, STORY_VOLUME_MAP_FILE), '# 卷图\n', 'utf8')
  await writeFile(join(root, STORY_RULES_MD), '# 规则\n', 'utf8')
  await writeFile(join(root, STORY_RULES_JSON), '{ "version": "2" }\n', 'utf8')
  await writeFile(join(root, STORY_PENDING_HOOKS), '# 伏笔池\n', 'utf8')
}

test('ready needs seven files and at least one card in any tier directory', async () => {
  const root = await workspace()
  try {
    await writeWork(root, { title: '就绪' })
    await seedFiles(root)
    assert.equal((await workProbes(root)).hasRoleCard, false)
    assert.deepEqual(storyNext({ ...(await workProbes(root)), title: '就绪' }), {
      work: '就绪',
      phase: 'draft',
      next: CAST_INDEX_STEP,
    })

    // 只认 .md，且四个目录任一都算。
    await mkdir(join(root, 'source/story/roles/主要角色'), { recursive: true })
    await writeFile(join(root, 'source/story/roles/主要角色/说明.txt'), 'not a card\n', 'utf8')
    assert.equal((await workProbes(root)).hasRoleCard, false, '非 md 不算卡')

    await writeFile(join(root, 'source/story/roles/主要角色/甲.md'), '# 甲\n', 'utf8')
    assert.equal((await workProbes(root)).hasRoleCard, true)
    assert.deepEqual(storyNext({ ...(await workProbes(root)), title: '就绪' }), {
      work: '就绪',
      phase: 'ready',
      next: NEXT_STEPS.ready,
    })
  } finally {
    await cleanup(root)
  }
})

test('the English tier directories are accepted, and an empty directory is not', async () => {
  const root = await workspace()
  try {
    await writeWork(root, { title: '英文目录' })
    await seedFiles(root)
    await mkdir(join(root, 'source/story/roles/major'), { recursive: true })
    assert.equal((await workProbes(root)).hasRoleCard, false, '空目录不算')

    await mkdir(join(root, 'source/story/roles/minor'), { recursive: true })
    await writeFile(join(root, 'source/story/roles/minor/乙.md'), '# 乙\n', 'utf8')
    assert.equal((await workProbes(root)).hasRoleCard, true)
  } finally {
    await cleanup(root)
  }
})

test('a manifest alone is not readiness, and readiness does not need a manifest', async () => {
  const root = await workspace()
  try {
    await mkdir(join(root, 'source/story/state'), { recursive: true })
    await writeFile(join(root, 'source/story/state/manifest.json'), '{}\n', 'utf8')
    const onlyManifest = await workProbes(root)
    assert.deepEqual(onlyManifest, {
      hasWork: false,
      hasFrame: false,
      hasVolumeMap: false,
      hasRulesMd: false,
      hasRulesJson: false,
      hasPendingHooks: false,
      hasRoleCard: false,
    })

    await writeWork(root, { title: '无 manifest' })
    await seedFiles(root)
    await mkdir(join(root, 'source/story/roles/major'), { recursive: true })
    await writeFile(join(root, 'source/story/roles/major/丙.md'), '# 丙\n', 'utf8')
    const probes = await workProbes(root)
    assert.equal(probes.hasRoleCard, true)
    assert.equal(storyNext({ ...probes, title: null }).phase, 'ready')
  } finally {
    await cleanup(root)
  }
})

test('a card is not probed while a required file is missing', async () => {
  const root = await workspace()
  try {
    await mkdir(join(root, 'source/story/roles/major'), { recursive: true })
    await writeFile(join(root, 'source/story/roles/major/甲.md'), '# 甲\n', 'utf8')
    const probes = await workProbes(root)
    assert.equal(probes.hasRoleCard, false, '必需文件缺一份时就先判不完整')
  } finally {
    await cleanup(root)
  }
})

test('draft points at details while rules or hooks are missing', async () => {
  const root = await workspace()
  try {
    await writeFile(join(root, STORY_FRAME_FILE), '# 大纲\n', 'utf8')
    await writeFile(join(root, STORY_VOLUME_MAP_FILE), '# 卷图\n', 'utf8')
    await mkdir(join(root, 'source/story/roles/major'), { recursive: true })
    await writeFile(join(root, 'source/story/roles/major/甲.md'), '# 甲\n', 'utf8')
    assert.deepEqual(storyNext({ ...(await workProbes(root)), title: null }), {
      work: null,
      phase: 'draft',
      next: NEXT_STEPS.draft,
    })
  } finally {
    await cleanup(root)
  }
})
