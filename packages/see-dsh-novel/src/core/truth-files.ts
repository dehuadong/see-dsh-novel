/**
 * 真值文件的名称规范化与白名单。
 *
 * 白名单与源实现一致：九份 `story/` 平铺文件、两份 `outline/`、四种角色目录。
 * 平铺与 outline 名字大小写不敏感并落盘为规范小写；角色卡保留原名大小写。
 */

/** `story/` 下的平铺真值文件。 */
export const FLAT_TRUTH_FILES = [
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

/** `story/outline/` 下的真值文件。 */
export const OUTLINE_TRUTH_FILES = ['outline/story_frame.md', 'outline/volume_map.md'] as const

/** 角色卡：`roles/<档位>/<名字>.md`，档位认中英文四种。 */
const ROLE_TRUTH_RE = /^roles\/(主要角色|次要角色|major|minor)\/[^/\\]+\.md$/u

/** `story/` 前缀；所有真值文件相对它命名。 */
export const STORY_PREFIX = 'source/story'

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
  if ((FLAT_TRUTH_FILES as ReadonlyArray<string>).includes(lower)) return lower
  if ((OUTLINE_TRUTH_FILES as ReadonlyArray<string>).includes(lower)) return lower
  if (ROLE_TRUTH_RE.test(withExtension)) return withExtension
  throw new Error(`不在白名单里的真值文件：${JSON.stringify(fileName)}`)
}

/** 真值文件名 → 作品根下的相对路径。 */
export function truthFileRelativePath(fileName: string): string {
  return `${STORY_PREFIX}/${fileName}`
}
