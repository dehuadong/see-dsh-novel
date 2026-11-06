import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import YAML from 'yaml'

import {
  installStorySkills,
  packageRootOf,
  parseSkill,
  readBundledSkills,
} from '../src/pipelines/long/skills.ts'

const packageRoot = packageRootOf(import.meta.url, 'see-dsh-novel')
const patch = YAML.parse(readFileSync(join(packageRoot, 'cordis.patch.yml'), 'utf8'))
const rows = patch.find((row) => Array.isArray(row.insert))?.insert ?? []
const preset = rows.find((row) => row.id === 'preset-see-dsh-novel')
const plugins = preset?.config?.plugins ?? []
const byId = new Map(plugins.map((plugin) => [plugin.id, plugin]))

/** 一根临时包目录，带指定的 skills 内容。 */
async function packageFixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-skills-'))
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content, 'utf8')
  }
  return root
}

const cleanup = (root) => rm(root, { recursive: true, force: true })

test('the preset lists the writing tool surface', () => {
  assert.ok(plugins.length > 0, 'preset-see-dsh-novel 没有 plugins')
  assert.deepEqual(
    plugins.map((plugin) => [plugin.id, plugin.name]),
    [
      ['persona', '@deepseek-ai/dsh-persona'],
      ['agent-instructions', '@deepseek-ai/dsh-agent-instructions'],
      ['time-context', '@deepseek-ai/dsh-time-context'],
      ['tool-fs', '@deepseek-ai/dsh-tool-fs'],
      ['tool-fs-search', '@deepseek-ai/dsh-tool-fs-search'],
      ['tool-skill', '@deepseek-ai/dsh-tool-skill'],
      ['tool-web', '@deepseek-ai/dsh-tool-web'],
      ['tool-subagent-control', '@deepseek-ai/dsh-tool-subagent-control'],
      ['tool-subagent', '@deepseek-ai/dsh-tool-subagent'],
      ['tool-ask-user', '@deepseek-ai/dsh-tool-ask-user'],
      ['tool-todo', '@deepseek-ai/dsh-tool-todo'],
      ['tool-jobs', '@deepseek-ai/dsh-tool-jobs'],
      ['tool-schedule', '@deepseek-ai/dsh-tool-schedule'],
      ['compaction', 'cordis:group'],
      ['see-dsh-novel-story', 'see-dsh-novel/agent'],
    ],
  )
})

test('the persona is the editor-in-chief, not the writer', () => {
  const prefix = byId.get('persona')?.config?.prefix ?? ''
  assert.match(prefix, /主编/)
  assert.match(prefix, /不亲自写正文/)
  assert.match(prefix, /只作参考/)
})

test('file tools are read-only and no shell is mounted', () => {
  assert.deepEqual(byId.get('tool-fs')?.config, { write: false, edit: false, applyPatch: false })
  assert.equal(byId.get('tool-fs-search')?.config?.sampleOverCapGlobResults, false)
  for (const forbidden of ['tool-bash', 'tool-pwsh']) {
    assert.equal(byId.has(forbidden), false, `预设不应挂载 ${forbidden}`)
  }
})

test('web, skills, subagents and compaction are mounted', () => {
  assert.deepEqual(byId.get('tool-web')?.config, { fetch: true, searchTimeoutMs: 60000 })
  assert.equal(byId.get('tool-skill')?.name, '@deepseek-ai/dsh-tool-skill')
  assert.deepEqual(byId.get('tool-subagent')?.config, { provider: 'spawn', toolName: 'subagent' })
  const compaction = byId.get('compaction')
  assert.equal(compaction?.name, 'cordis:group')
  assert.equal(compaction?.group, true)
  assert.deepEqual(compaction?.config?.map((entry) => entry.id), [
    'compaction-basic',
    'command-compact',
    'tool-result-pruner',
  ])
})

test('the packaged skill exposes its method body', () => {
  const skills = readBundledSkills(packageRoot)
  const skill = skills.find((entry) => entry.name === 'longform-writing')
  assert.ok(skill, '缺少 longform-writing')
  assert.match(skill.description, /长篇/)
  assert.match(skill.content, /^# 长篇写作方法/m)
  assert.match(skill.content, /提及不等于推进/)
  // 技能束：SKILL.md 负责方法路由，四份参考文件承载细节方法。
  assert.match(skill.content, /references\/foundation-design\.md/)
  assert.match(skill.content, /references\/state-projection\.md/)
  for (const reference of ['foundation-design', 'reader-contract-and-progression', 'scene-dialogue-and-length-budget', 'state-projection']) {
    const path = join(packageRoot, 'skills/longform-writing/references', `${reference}.md`)
    assert.ok(readFileSync(path, 'utf8').trim().length > 0, `缺少参考文件 ${reference}.md`)
  }
  assert.deepEqual(skill.invocation, { modelInvocable: true, userInvocable: true })
})

test('installation registers every packaged skill and cleans up', () => {
  const registered = []
  const ctx = {
    skills: {
      register(skill) {
        registered.push(skill)
        return () => {
          const index = registered.indexOf(skill)
          if (index >= 0) registered.splice(index, 1)
        }
      },
    },
  }
  const dispose = installStorySkills(ctx, packageRoot)
  assert.deepEqual(registered.map((skill) => skill.name), ['longform-writing', 'story-proposal', 'story-review'])
  assert.equal(registered[0]?.source, 'runtime')
  dispose()
  assert.deepEqual(registered, [])
})

test('frontmatter flags map to the invocation policy', () => {
  const base = '---\nname: sample-skill\ndescription: 说明\n'
  assert.deepEqual(parseSkill(`${base}---\n正文\n`, 'sample').invocation, {
    modelInvocable: true,
    userInvocable: true,
  })
  assert.deepEqual(parseSkill(`${base}disable-model-invocation: true\n---\n正文\n`, 'sample').invocation, {
    modelInvocable: false,
    userInvocable: true,
  })
  assert.deepEqual(parseSkill(`${base}user-invocable: false\n---\n正文\n`, 'sample').invocation, {
    modelInvocable: true,
    userInvocable: false,
  })
})

test('a broken skill file fails loudly instead of vanishing', () => {
  assert.throws(() => parseSkill('name: x\n', 'sample'), /缺少 frontmatter/)
  assert.throws(() => parseSkill('---\nname: Bad Name\ndescription: 说明\n---\n正文\n', 'sample'), /kebab-case/)
  assert.throws(() => parseSkill('---\nname: sample\n---\n正文\n', 'sample'), /缺少 description/)
  assert.throws(() => parseSkill('---\nname: sample\ndescription: 说明\n---\n', 'sample'), /正文为空/)
  assert.throws(
    () => parseSkill('---\nname: sample\ndescription: 说明\nuser-invocable: maybe\n---\n正文\n', 'sample'),
    /只能是 true 或 false/,
  )
})

test('an install missing its skills directory fails loudly', async () => {
  const empty = await packageFixture({})
  const broken = await packageFixture({ 'skills/orphan/notes.txt': '没有 SKILL.md' })
  try {
    assert.throws(() => readBundledSkills(empty), /读不到技能目录/)
    assert.throws(() => readBundledSkills(broken), /缺少 SKILL.md/)
  } finally {
    await cleanup(empty)
    await cleanup(broken)
  }
})

test('a skills directory with no skill in it fails loudly', async () => {
  const root = await packageFixture({ 'skills/README.md': '空目录占位' })
  try {
    assert.throws(() => readBundledSkills(root), /没有任何技能/)
  } finally {
    await cleanup(root)
  }
})

test('the package root resolves from the test file', () => {
  assert.equal(readFileSync(join(packageRoot, 'package.json'), 'utf8').includes('"see-dsh-novel"'), true)
  assert.equal(packageRoot.endsWith('see-dsh-novel'), true)
  assert.throws(() => packageRootOf(import.meta.url, 'some-other-package'), /包根不是 some-other-package/)
})

test('an unknown frontmatter key is rejected', () => {
  assert.throws(
    () => parseSkill('---\nname: sample\ndescription: 说明\ndisable-model-invocationn: true\n---\n正文\n', 'sample'),
    /未知键：disable-model-invocationn/,
  )
})

