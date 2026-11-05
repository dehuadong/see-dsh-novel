import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  BOOK_RULES_JSON,
  BOOK_RULES_MD,
  bookRulesDataSchema,
  bookRulesFieldNames,
  parseBookRules,
  readBookRules,
  withVersion,
} from '../src/pipelines/long/book-rules.ts'

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'see-dsh-novel-rules-'))
  await mkdir(join(root, 'source/story'), { recursive: true })
  return root
}

const cleanup = (root) => rm(root, { recursive: true, force: true })

const minimal = { prohibitions: [], enableFullCastTracking: false, allowedDeviations: [] }

test('withVersion injects the version and keeps the field order', () => {
  assert.deepEqual(withVersion(minimal), { version: '2', ...minimal })
  assert.equal(Object.keys(withVersion(minimal))[0], 'version', 'version 必须在最前')
  assert.equal(Object.keys(withVersion({ ...minimal, narrativePerson: '第一人称' }))[1], 'narrativePerson')
  assert.deepEqual(withVersion({ ...minimal, narrativePerson: ' 第一人称 ' }), {
    version: '2',
    narrativePerson: '第一人称',
    ...minimal,
  })
})

test('missing required fields and unknown fields are rejected', () => {
  assert.throws(() => parseBookRules({ version: '2', prohibitions: [] }), /enableFullCastTracking/)
  assert.throws(() => parseBookRules({ version: '2', ...minimal, extra: 1 }), /未知字段 "extra"/)
  assert.throws(() => parseBookRules({ version: '1', ...minimal }), /version 必须是 "2"/)
  assert.throws(() => parseBookRules({ ...minimal }), /version 必须是 "2"/)
  assert.throws(() => parseBookRules({ version: '2', ...minimal, narrativePerson: '   ' }), /narrativePerson 必须是非空字符串/)
  assert.throws(() => parseBookRules({ version: '2', ...minimal, enableFullCastTracking: 'yes' }), /必须是布尔/)
})

test('bare strings and arrays follow the source schema, not stricter rules', () => {
  const parsed = parseBookRules({
    version: '2',
    protagonist: { name: '', personalityLock: [], behavioralConstraints: [''] },
    genreLock: { primary: '', forbidden: [''] },
    prohibitions: [''],
    enableFullCastTracking: true,
    allowedDeviations: [''],
  })
  assert.equal(parsed.protagonist?.name, '')
  assert.deepEqual(parsed.prohibitions, [''])
  assert.deepEqual(parsed.allowedDeviations, [''])

  assert.throws(() => parseBookRules({
    version: '2',
    ...minimal,
    protagonist: { name: '甲', personalityLock: [] },
  }), /protagonist 缺少字段 "behavioralConstraints"/)
  assert.throws(() => parseBookRules({
    version: '2',
    ...minimal,
    protagonist: { name: '甲', personalityLock: [], behavioralConstraints: [], extra: 1 },
  }), /protagonist 里的未知字段/)

  // 原型链上的名字也是未知字段，不能被 `in` 放行。
  assert.throws(() => parseBookRules({
    version: '2',
    ...minimal,
    protagonist: { name: '甲', personalityLock: [], behavioralConstraints: [], constructor: 1 },
  }), /protagonist 里的未知字段 "constructor"/)
})

test('readBookRules returns the rules and the trimmed body', async () => {
  const root = await workspace()
  try {
    await writeFile(join(root, BOOK_RULES_MD), '\n  规则正文  \n\n', 'utf8')
    await writeFile(join(root, BOOK_RULES_JSON), `${JSON.stringify(withVersion(minimal), null, 2)}\n`, 'utf8')
    const { rules, body } = await readBookRules(root)
    assert.deepEqual(rules, { version: '2', ...minimal })
    assert.equal(body, '规则正文')
  } finally {
    await cleanup(root)
  }
})

test('readBookRules fails loud on missing, broken or unversioned files', async () => {
  const root = await workspace()
  try {
    await writeFile(join(root, BOOK_RULES_MD), 'x\n', 'utf8')
    await writeFile(join(root, BOOK_RULES_JSON), '{ not json', 'utf8')
    await assert.rejects(readBookRules(root), /不是合法 JSON/)

    await writeFile(join(root, BOOK_RULES_JSON), JSON.stringify(minimal), 'utf8')
    await assert.rejects(readBookRules(root), /version 必须是 "2"/)

    await rm(join(root, BOOK_RULES_MD))
    await writeFile(join(root, BOOK_RULES_JSON), JSON.stringify(withVersion(minimal)), 'utf8')
    await assert.rejects(readBookRules(root), /book_rules\.md/)

    await writeFile(join(root, BOOK_RULES_MD), 'x\n', 'utf8')
    await rm(join(root, BOOK_RULES_JSON))
    await assert.rejects(readBookRules(root), /book_rules\.json/)
  } finally {
    await cleanup(root)
  }
})

test('the tool schema and the validator share one field list', () => {
  const schema = bookRulesDataSchema()
  const properties = Object.keys(schema.properties ?? {})
  assert.deepEqual(properties, bookRulesFieldNames())
  assert.equal(properties.includes('version'), false, '模型不提供 version')
  assert.match(JSON.stringify(schema.properties.narrativePerson), /作者自己的表述/)
  assert.deepEqual(schema.required, ['prohibitions', 'enableFullCastTracking', 'allowedDeviations'])
})
