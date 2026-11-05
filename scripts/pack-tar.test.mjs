import test from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'

import { readPackageEntries, TarReadError } from './pack-tar.mjs'

/** 拼一个 tar 条目头；只填读取器用到的字段。 */
function header(name, { size = 0, type = '0', prefix = '', linkname = '' } = {}) {
  const block = Buffer.alloc(512, 0)
  block.write(name, 0, 'utf8')
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'utf8')
  block.write(type, 156, 'utf8')
  if (linkname !== '') block.write(linkname, 157, 'utf8')
  block.write('ustar\0', 257, 'utf8')
  if (prefix !== '') block.write(prefix, 345, 'utf8')
  return block
}

/** 把若干条目拼成 tar 字节；`type` 为 `5` 时忽略内容。 */
function tar(entries) {
  const blocks = []
  for (const entry of entries) {
    const body = Buffer.from(entry.content ?? '')
    const size = entry.size ?? body.length
    blocks.push(header(entry.name, { size, type: entry.type ?? '0', prefix: entry.prefix ?? '', linkname: entry.linkname ?? '' }))
    blocks.push(body, Buffer.alloc((512 - (size % 512)) % 512, 0))
  }
  blocks.push(Buffer.alloc(1024, 0))
  return gzipSync(Buffer.concat(blocks))
}

test('reads regular files and directories with the package prefix stripped', () => {
  const entries = readPackageEntries(tar([
    { name: 'package/', type: '5' },
    { name: 'package/package.json', content: '{"name":"x"}' },
    { name: 'package/lib/index.js', content: 'export {}\n' },
    { name: 'package/', type: '5' },
  ]))
  assert.deepEqual(entries.map((entry) => entry.path), ['package.json', 'lib/index.js'])
  assert.equal(entries[0].content.toString('utf8'), '{"name":"x"}')
})

/** 拼一个条目（头 + 内容 + 填充），供特殊 type 复用。 */
function block(name, { content = '', type = '0' } = {}) {
  const body = Buffer.from(content)
  return Buffer.concat([
    header(name, { size: body.length, type }),
    body,
    Buffer.alloc((512 - (body.length % 512)) % 512, 0),
  ])
}

test('accepts a GNU long name and a pax path', () => {
  const long = 'package/skills/' + 'a'.repeat(120) + '/SKILL.md'
  const pax = '30 path=package/pax-name.js\n'
  const data = Buffer.concat([
    block('longname', { type: 'L', content: `${long}\0` }),
    block('truncated-name', { content: 'x' }),
    block('paxheader', { type: 'x', content: pax }),
    block('package/truncated.js', { content: '{}\n' }),
    Buffer.alloc(1024, 0),
  ])
  const entries = readPackageEntries(gzipSync(data))
  assert.deepEqual(entries.map((entry) => entry.path), [long.slice('package/'.length), 'pax-name.js'])
})

test('rejects links, traversal, absolute names and duplicates', () => {
  assert.throws(() => readPackageEntries(tar([{ name: 'package/a', type: '1', linkname: 'x' }])), TarReadError)
  assert.throws(() => readPackageEntries(gzipSync(Buffer.concat([
    header('package/link.js', { type: '2', linkname: 'package.json' }), Buffer.alloc(1024, 0),
  ]))), /带链接/)
  assert.throws(() => readPackageEntries(tar([{ name: 'package/../x.js', content: 'x' }])), /不安全/)
  assert.throws(() => readPackageEntries(tar([{ name: '/etc/passwd', content: 'x' }])), /不安全/)
  assert.throws(() => readPackageEntries(tar([
    { name: 'package/a.js', content: 'a' },
    { name: 'package/A.js', content: 'b' },
  ])), /重复条目/)
  assert.throws(() => readPackageEntries(gzipSync(Buffer.alloc(1024, 0))), /没有任何文件条目/)
})
