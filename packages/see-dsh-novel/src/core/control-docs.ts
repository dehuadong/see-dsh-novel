/**
 * 三份控制文档：brief 与两份方向文档。
 *
 * 播种只在文件缺失时发生，内容对齐源工程的语言默认模板；读取前先补默认，
 * 与「加载控制文档」的行为一致。
 */
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { commitFoundation, pathExists } from './commit.js'
import type { FileWrite } from './commit.js'
import {
  AUTHOR_INTENT_FILE,
  BRIEF_FILE,
  CURRENT_FOCUS_FILE,
} from './story-paths.js'

export interface ControlDocs {
  brief: string
  authorIntent: string
  currentFocus: string
}

/** 方向文档的默认正文；与源工程的模板逐字一致。 */
export function defaultAuthorIntent(language: 'zh' | 'en'): string {
  return language === 'en'
    ? '# Author Intent\n\n(Describe the long-horizon vision for this book here.)\n'
    : '# 作者意图\n\n（在这里描述这本书的长期创作方向。）\n'
}

export function defaultCurrentFocus(language: 'zh' | 'en'): string {
  return language === 'en'
    ? '# Current Focus\n\n## Active Focus\n\n(Describe what the next 1-3 chapters should prioritize.)\n'
    : '# 当前聚焦\n\n## 当前重点\n\n（描述接下来 1-3 章最需要优先推进的内容。）\n'
}

/**
 * 生成缺失的方向文档写入项；已有文件不覆盖。
 * @param root 作品根
 * @param language 模板语言
 * @param authorIntent 作者给出的长期方向；空白时用默认模板
 * @returns 缺失文件的写入项，可并入同一次提交
 */
export async function ensureControlDocuments(
  root: string,
  language: 'zh' | 'en',
  authorIntent?: string,
): Promise<FileWrite[]> {
  const base = resolve(root)
  const writes: FileWrite[] = []
  if (!(await pathExists(join(base, AUTHOR_INTENT_FILE)))) {
    writes.push({
      relativePath: AUTHOR_INTENT_FILE,
      content: authorIntent !== undefined && authorIntent.trim() !== ''
        ? `${authorIntent.trimEnd()}\n`
        : defaultAuthorIntent(language),
    })
  }
  if (!(await pathExists(join(base, CURRENT_FOCUS_FILE)))) {
    writes.push({ relativePath: CURRENT_FOCUS_FILE, content: defaultCurrentFocus(language) })
  }
  return writes
}

/**
 * 读三份控制文档；缺失的方向文档先补默认模板，brief 缺了按空串返回。
 * @param root 作品根
 * @param language 没有作品身份时的模板语言
 */
export async function readControlDocs(root: string, language: 'zh' | 'en' = 'zh'): Promise<ControlDocs> {
  const base = resolve(root)
  const writes = await ensureControlDocuments(base, language)
  if (writes.length > 0) await commitFoundation(base, { writes })
  const read = async (relativePath: string): Promise<string> => {
    try {
      return await readFile(join(base, relativePath), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
      throw error
    }
  }
  const [brief, authorIntent, currentFocus] = await Promise.all([
    read(BRIEF_FILE),
    read(AUTHOR_INTENT_FILE),
    read(CURRENT_FOCUS_FILE),
  ])
  return { brief, authorIntent, currentFocus }
}
