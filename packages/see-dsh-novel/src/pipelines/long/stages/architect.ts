/**
 * 基础设定的架构契约：作品元信息 + 外部指令 + 提交要求。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { STORY_EXTERNAL_BRIEF } from '../../../core/story-paths.js'
import type { WorkLanguage } from '../../../core/work.js'

interface WorkMeta {
  title?: string
  language?: WorkLanguage
  metadata?: {
    genre?: string
    platform?: string
    targetChapters?: number
    chapterWordCount?: number
  }
}

function readWorkMeta(root: string): WorkMeta {
  try {
    return JSON.parse(readFileSync(join(root, 'work.json'), 'utf8')) as WorkMeta
  } catch {
    return {}
  }
}

/** 架构契约；work.json 损坏时退化为只含提交要求。 */
export function renderArchitectContract(root: string): string {
  const work = readWorkMeta(root)
  const language: WorkLanguage = work.language === 'en' ? 'en' : 'zh'
  let brief = ''
  try {
    if (existsSync(join(root, STORY_EXTERNAL_BRIEF))) brief = readFileSync(join(root, STORY_EXTERNAL_BRIEF), 'utf8').trim()
  } catch {
    brief = ''
  }
  const metadata = language === 'en'
    ? [
        `Platform: ${work.metadata?.platform ?? ''}`,
        `Genre: ${work.metadata?.genre ?? ''}`,
        `Target chapters: ${work.metadata?.targetChapters ?? ''}`,
        `Chapter length: ${work.metadata?.chapterWordCount ?? ''}`,
        `Title: ${work.title ?? ''}`,
      ].join('\n')
    : [
        `平台：${work.metadata?.platform ?? ''}`,
        `题材：${work.metadata?.genre ?? ''}`,
        `目标章数：${work.metadata?.targetChapters ?? ''}`,
        `每章字数：${work.metadata?.chapterWordCount ?? ''}`,
        `标题：${work.title ?? ''}`,
      ].join('\n')

  if (language === 'en') {
    return [
      'Create the Work foundation using the supplied craft guidance and input authority.',
      brief === '' ? '' : `\n## External Instructions\n${brief}\n`,
      `\n## Work metadata\n${metadata}`,
      '\nSubmit readable foundation artifacts and the small structured rules surface through the required tools.',
    ].join('')
  }
  return [
    '按随阶段提供的创作方法和输入权威生成作品基础设定。',
    brief === '' ? '' : `\n\n## 外部指令\n${brief}\n`,
    `\n\n## 作品元信息\n${metadata}`,
    '\n\n通过指定工具提交可读基础资产和少量结构化规则。',
  ].join('')
}
