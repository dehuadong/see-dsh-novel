/**
 * 从 `.tgz` 字节里读条目，不做磁盘解压。
 *
 * 只接受普通文件与目录；符号链接、硬链接、绝对路径、`..`、同名条目一律拒绝。
 * 归档坏了就抛 `TarReadError`，让调用方以 `tar-read-error` 退出，而不是继续对账。
 */
import { gunzipSync } from 'node:zlib'

/** 归档读取失败；`code` 固定，脚本据此报告。 */
export class TarReadError extends Error {
  constructor(message) {
    super(message)
    this.name = 'TarReadError'
    this.code = 'tar-read-error'
  }
}

const MAGIC = Buffer.from([0x1f, 0x8b])
const HEADER = 512

/** 读一个以 NUL 结尾的字段。 */
function field(header, start, size) {
  return header.toString('utf8', start, start + size).replace(/\0[\s\S]*$/, '')
}

/**
 * 读 tarball。
 * @param {Buffer} bytes `.tgz` 的字节（gzip）
 * @returns {{ path: string, content: Buffer }[]} `package/` 之后的相对路径
 */
export function readPackageEntries(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new TarReadError('tarball 是空的')
  const data = bytes.subarray(0, 2).equals(MAGIC)
    ? gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 })
    : bytes
  /** @type {{ path: string, content: Buffer }[]} */
  const entries = []
  const seen = new Set()
  let offset = 0
  let pendingPath

  while (offset + HEADER <= data.length) {
    const header = data.subarray(offset, offset + HEADER)
    if (header.every((byte) => byte === 0)) break
    const sizeText = field(header, 124, 12).trim()
    const size = Number.parseInt(sizeText === '' ? '0' : sizeText, 8)
    if (!Number.isSafeInteger(size) || size < 0 || offset + HEADER + size > data.length) {
      throw new TarReadError(`条目大小非法：${sizeText}`)
    }
    const type = field(header, 156, 1)
    const body = data.subarray(offset + HEADER, offset + HEADER + size)
    offset += HEADER + Math.ceil(size / HEADER) * HEADER

    if (type === 'x') {
      const pax = body.toString('utf8')
      if (/\blinkpath=/.test(pax)) throw new TarReadError('归档里带链接（pax linkpath）')
      const matched = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(pax)
      if (matched !== null) pendingPath = matched[1]
      continue
    }
    if (type === 'L') {
      pendingPath = body.toString('utf8').replace(/\0[\s\S]*$/, '')
      continue
    }
    if (type === '1' || type === '2') throw new TarReadError(`归档里带链接条目（type ${type}）`)
    if (type !== '' && type !== '0' && type !== '5') {
      throw new TarReadError(`不支持的条目类型：${type}`)
    }

    const prefix = field(header, 345, 155)
    const name = pendingPath ?? (prefix === '' ? field(header, 0, 100) : `${prefix}/${field(header, 0, 100)}`)
    pendingPath = undefined
    assertSafeName(name)
    if (!name.startsWith('package/')) throw new TarReadError(`条目不在 package/ 下：${name}`)
    if (type === '5') continue
    const relative = name.slice('package/'.length)
    if (relative === '') throw new TarReadError('空的文件条目')
    const key = relative.toLowerCase()
    if (seen.has(key)) throw new TarReadError(`重复条目：${relative}`)
    seen.add(key)
    entries.push({ path: relative, content: Buffer.from(body) })
  }

  if (entries.length === 0) throw new TarReadError('归档里没有任何文件条目')
  return entries
}

/** 绝对路径、反斜杠、盘符、`..`/`.` 段都拒绝；目录名允许一个尾斜杠。 */
function assertSafeName(name) {
  if (name === '' || name.startsWith('/') || name.includes('\\') || name.includes(':')) {
    throw new TarReadError(`不安全的条目名：${name}`)
  }
  const trimmed = name.endsWith('/') ? name.slice(0, -1) : name
  if (trimmed === '') throw new TarReadError(`不安全的条目名：${name}`)
  for (const segment of trimmed.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new TarReadError(`不安全的条目路径：${name}`)
    }
  }
}
