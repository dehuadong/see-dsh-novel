/**
 * 作品工件的集合与摘要。
 *
 * 工件是 `source/story/` 下的全部文件。摘要只取决于相对路径与内容，
 * 因此「写过」与「摘要变了」是同一件事：作者确认过一次之后，任何写入都会
 * 让那条确认失效，不需要另外记录或比对路径集合。
 */
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

/** 一根作品里的基础设定所在目录。 */
const WORK_DIR = 'source/story'

export interface ArtifactSet {
  /** 相对作品根的路径，`/` 分隔，按升序排列。 */
  files: string[]
  /** 集合与内容的 sha256 十六进制串；空集合为空串。 */
  digest: string
}

/** 递归收集文件；目录不存在按空处理，其它读取错误照常抛出。 */
async function walk(dir: string, out: string[]): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(path, out)
      continue
    }
    if (entry.isFile()) out.push(path)
  }
}

/** 摘要取前八位给作者核对；渲染与命令共用，避免两处写死长度。 */
export function shortDigest(digest: string): string {
  return digest.slice(0, 8)
}

/**
 * 读取作品当前的工件集合与摘要。
 * @param root 作品根目录
 */
export async function readArtifacts(root: string): Promise<ArtifactSet> {
  const absolute: string[] = []
  await walk(join(root, WORK_DIR), absolute)
  const files = absolute
    .map((path) => relative(root, path).split(sep).join('/'))
    .sort()
  if (files.length === 0) return { files, digest: '' }

  const hash = createHash('sha256')
  for (const relativePath of files) {
    const content = await readFile(join(root, relativePath))
    // 长度参与摘要，避免「路径 + 内容」拼接产生不同文件集合同一串。
    hash.update(relativePath, 'utf8')
    hash.update('\n', 'utf8')
    hash.update(String(content.byteLength), 'utf8')
    hash.update('\n', 'utf8')
    hash.update(content)
  }
  return { files, digest: hash.digest('hex') }
}
