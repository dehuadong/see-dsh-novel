/**
 * 三份控制文档：brief 与两份方向文档。
 *
 * 播种只在文件缺失时发生；读取前先补默认。
 */
import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { commitFoundation, pathExists } from './commit.js'
import type { FileWrite } from './commit.js'
import type { ProjectionLanguage } from './state-projections.js'
import { ROLE_DIR_NAMES } from './story-paths.js'
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

/** 方向文档的默认正文；中文与英文各一份。 */
export function defaultAuthorIntent(language: ProjectionLanguage): string {
  return language === 'en'
    ? '# Author Intent\n\n(Describe the long-horizon vision for this book here.)\n'
    : '# 作者意图\n\n（在这里描述这本书的长期创作方向。）\n'
}

export function defaultCurrentFocus(language: ProjectionLanguage): string {
  return language === 'en'
    ? '# Current Focus\n\n## Active Focus\n\n(Describe what the next 1-3 chapters should prioritize.)\n'
    : '# 当前聚焦\n\n## 当前重点\n\n（描述接下来 1-3 章最需要优先推进的内容。）\n'
}

/**
 * 补齐空目录并生成缺失的方向文档写入项；已有文件不覆盖。
 * @param root 作品根
 * @param language 模板语言
 * @returns 缺失文件的写入项，可并入同一次提交
 */
export async function controlDocumentWrites(root: string, language: ProjectionLanguage): Promise<FileWrite[]> {
  const base = resolve(root)
  // 目录先建齐：即使三份文档都已存在，作者也应看到完整的作品骨架。
  await Promise.all([
    mkdir(join(base, 'source/story'), { recursive: true }),
    mkdir(join(base, 'source/story/runtime'), { recursive: true }),
    mkdir(join(base, 'source/story/outline'), { recursive: true }),
    mkdir(join(base, 'source/story/roles', ROLE_DIR_NAMES.major), { recursive: true }),
    mkdir(join(base, 'source/story/roles', ROLE_DIR_NAMES.minor), { recursive: true }),
  ])
  const writes: FileWrite[] = []
  if (!(await pathExists(join(base, AUTHOR_INTENT_FILE)))) {
    writes.push({ relativePath: AUTHOR_INTENT_FILE, content: defaultAuthorIntent(language) })
  }
  if (!(await pathExists(join(base, CURRENT_FOCUS_FILE)))) {
    writes.push({ relativePath: CURRENT_FOCUS_FILE, content: defaultCurrentFocus(language) })
  }
  return writes
}

/**
 * 读三份控制文档；缺失的方向文档先补默认模板，brief 缺了按空串返回。
 * @param root 作品根
 * @param language 模板语言；调用方按作品身份解析后传入
 */
export async function readControlDocs(root: string, language: ProjectionLanguage = 'zh'): Promise<ControlDocs> {
  const base = resolve(root)
  const writes = await controlDocumentWrites(base, language)
  if (writes.length > 0) await commitFoundation(base, { writes })
  const [brief, authorIntent, currentFocus] = await Promise.all([
    readFile(join(base, BRIEF_FILE), 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return ''
      throw error
    }),
    readFile(join(base, AUTHOR_INTENT_FILE), 'utf8'),
    readFile(join(base, CURRENT_FOCUS_FILE), 'utf8'),
  ])
  return { brief, authorIntent, currentFocus }
}
