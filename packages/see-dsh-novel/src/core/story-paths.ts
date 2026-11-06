/**
 * 作品文件的路径表：身份、大纲、book rules、伏笔投影、状态目录与角色目录。
 *
 * 写入方、读取方与就绪判据共用同一份常量，避免同一个路径在两处写字面量。
 */

/** 身份文件；与 `source/` 同级。 */
export const WORK_FILE = 'work.json'

/** 状态目录；四份 JSON 在这里。 */
export const STATE_DIR = 'source/story/state'

/** 立项时写入的立意原文。 */
export const BRIEF_FILE = 'source/brief.md'

/** 两份方向文档：长期方向与近期焦点。 */
export const AUTHOR_INTENT_FILE = 'source/story/author_intent.md'
export const CURRENT_FOCUS_FILE = 'source/story/current_focus.md'

/** 大纲两份。 */
export const STORY_FRAME_FILE = 'source/story/outline/story_frame.md'
export const STORY_VOLUME_MAP_FILE = 'source/story/outline/volume_map.md'

/** book rules 两份；结构化那份是写作角色读的。 */
export const STORY_RULES_MD = 'source/story/book_rules.md'
export const STORY_RULES_JSON = 'source/story/book_rules.json'

/** 风格与同人素材；写入方是真值文件工具，读取方随对应能力接上。 */
export const STORY_STYLE_GUIDE_MD = 'source/story/style_guide.md'
export const STORY_PARENT_CANON_MD = 'source/story/parent_canon.md'
export const STORY_FANFIC_CANON_MD = 'source/story/fanfic_canon.md'

/** 三份 Markdown 投影；`pending_hooks.md` 也是就绪判据的一部分。 */
export const STORY_CURRENT_STATE_MD = 'source/story/current_state.md'
export const STORY_PENDING_HOOKS = 'source/story/pending_hooks.md'
export const STORY_CHAPTER_SUMMARIES_MD = 'source/story/chapter_summaries.md'

/** 角色级别 → 磁盘目录名。 */
export const ROLE_DIR_NAMES = { major: '主要角色', minor: '次要角色' } as const

/** 角色卡目录：中文名与英文名都认，任一目录里有一张 `.md` 就算有角色卡。 */
export const ROLE_TIER_DIRS = [
  `source/story/roles/${ROLE_DIR_NAMES.major}`,
  'source/story/roles/major',
  `source/story/roles/${ROLE_DIR_NAMES.minor}`,
  'source/story/roles/minor',
] as const
