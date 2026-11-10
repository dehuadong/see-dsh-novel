import test from 'node:test'
import assert from 'node:assert/strict'
import { stat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { installStorySkills } from '../src/pipelines/long/skills.ts'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))

/** 只实现 skills.register 的假上下文；收集注册项。 */
function install() {
  const registered = []
  const ctx = {
    skills: {
      register(skill) {
        registered.push(skill)
        return () => {}
      },
    },
  }
  const dispose = installStorySkills(ctx, packageRoot)
  return { registered, dispose }
}

test('every bundled skill carries a provider and a resource directory', () => {
  const { registered, dispose } = install()
  try {
    assert.ok(registered.length >= 3)
    for (const skill of registered) {
      assert.equal(skill.provider, 'see-dsh-novel')
      assert.equal(skill.resourceBase.kind, 'directory')
      assert.equal(skill.resourceBase.path, join(packageRoot, 'skills', skill.name))
    }
  } finally {
    dispose()
  }
})

test('the review skill reference file is reachable from its resource base', async () => {
  const { registered, dispose } = install()
  try {
    const review = registered.find((skill) => skill.name === 'story-review')
    assert.ok(review, '应注册 story-review')
    const reference = join(review.resourceBase.path, 'references', 'review-matrix.md')
    assert.ok((await stat(reference)).isFile())
    const text = await readFile(reference, 'utf8')
    assert.ok(text.trim().length > 0)
  } finally {
    dispose()
  }
})

test('the longform skill exposes its reference directory the same way', async () => {
  const { registered, dispose } = install()
  try {
    const longform = registered.find((skill) => skill.name === 'longform-writing')
    assert.ok(longform, '应注册 longform-writing')
    const reference = join(longform.resourceBase.path, 'references', 'scene-dialogue-and-length-budget.md')
    assert.ok((await stat(reference)).isFile())
  } finally {
    dispose()
  }
})
