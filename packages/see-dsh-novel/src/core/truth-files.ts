/**
 * 真值文件的名称规范化与白名单。
 *
 * 白名单：九份 `story/` 平铺文件、两份 `outline/`、四种角色目录。平铺与 outline
 * 名字大小写不敏感并落盘为规范小写；角色卡保留原名大小写。
 */
import {
  AUTHOR_INTENT_FILE,
  CURRENT_FOCUS_FILE,
  ROLE_DIR_NAMES,
  STORY_CHAPTER_SUMMARIES_MD,
  STORY_CURRENT_STATE_MD,
  STORY_FANFIC_CANON_MD,
  STORY_FRAME_FILE,
  STORY_PARENT_CANON_MD,
  STORY_PENDING_HOOKS,
  STORY_ROOT,
  STORY_RULES_MD,
  STORY_STYLE_GUIDE_MD,
  STORY_VOLUME_MAP_FILE,
} from './story-paths.js'

/** 白名单里的规范名 → 作品根下的相对路径。 */
export const TRUTH_FILE_PATHS: Readonly<Record<string, string>> = {
  'author_intent.md': AUTHOR_INTENT_FILE,
  'current_focus.md': CURRENT_FOCUS_FILE,
  'book_rules.md': STORY_RULES_MD,
  'style_guide.md': STORY_STYLE_GUIDE_MD,
  'parent_canon.md': STORY_PARENT_CANON_MD,
  'fanfic_canon.md': STORY_FANFIC_CANON_MD,
  'current_state.md': STORY_CURRENT_STATE_MD,
  'pending_hooks.md': STORY_PENDING_HOOKS,
  'chapter_summaries.md': STORY_CHAPTER_SUMMARIES_MD,
  'outline/story_frame.md': STORY_FRAME_FILE,
  'outline/volume_map.md': STORY_VOLUME_MAP_FILE,
}

/** 可写的平铺名字（含 book rules；`book_rules.json` 只随 md 一起写）。 */
const FLAT_NAMES = [
  'author_intent.md',
  'current_focus.md',
  'book_rules.md',
  'style_guide.md',
  'parent_canon.md',
  'fanfic_canon.md',
  'current_state.md',
  'pending_hooks.md',
  'chapter_summaries.md',
] as const

/** 可写的 outline 名字。 */
const OUTLINE_NAMES = ['outline/story_frame.md', 'outline/volume_map.md'] as const

/** 角色卡档位：中文名来自路径表，英文名是兼容别名。 */
const ROLE_TIERS: ReadonlyArray<string> = [...Object.values(ROLE_DIR_NAMES), 'major', 'minor']

/** 角色卡：`roles/<档位>/<名字>.md`。 */
const ROLE_TRUTH_RE = new RegExp(`^roles/(${ROLE_TIERS.join('|')})/[^/\\\\]+\\.md$`, 'u')

/** 报错里列出的允许名字。 */
const ALLOWED_NAMES = [...FLAT_NAMES, ...OUTLINE_NAMES, `roles/(${ROLE_TIERS.join('|')})/<name>.md`]

/**
 * 规范化真值文件名。
 * @param fileName 作者给的名字（可省略 `.md`）
 * @returns 白名单里的规范路径（相对 `source/story/`）
 * @throws 名字越界、为空或不在白名单
 */
export function normalizeTruthFileName(fileName: string): string {
  const trimmed = String(fileName ?? '').trim()
  if (trimmed === '') throw new Error('fileName 不能为空')
  if (trimmed.startsWith('/') || trimmed.includes('\\') || trimmed.includes('\0') || trimmed.includes('..')) {
    throw new Error(`fileName 不能是绝对路径、反斜杠或包含 ..：${JSON.stringify(fileName)}`)
  }
  const withExtension = trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`
  const lower = withExtension.toLowerCase()
  if ((FLAT_NAMES as ReadonlyArray<string>).includes(lower)) return lower
  if ((OUTLINE_NAMES as ReadonlyArray<string>).includes(lower)) return lower
  if (ROLE_TRUTH_RE.test(withExtension)) return withExtension
  throw new Error(`不在白名单里的真值文件：${JSON.stringify(fileName)}；允许：${ALLOWED_NAMES.join('、')}`)
}

/**
 * 真值文件名 → 作品根下的相对路径。
 * @param fileName 已规范化的名字或角色卡路径
 */
export function truthFileRelativePath(fileName: string): string {
  const known = TRUTH_FILE_PATHS[fileName]
  if (known !== undefined) return known
  if (ROLE_TRUTH_RE.test(fileName)) return `${STORY_ROOT}/${fileName}`
  throw new Error(`没有路径映射的真值文件：${JSON.stringify(fileName)}`)
}
