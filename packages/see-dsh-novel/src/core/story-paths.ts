/**
 * 作品文件的路径表：身份、大纲、book rules、伏笔投影、状态目录与角色目录。
 *
 * 写入方、读取方与就绪判据共用同一份常量，避免同一个路径在两处写字面量。
 */

/** 作品内容根目录；story 相关路径都由它拼出。 */
export const STORY_ROOT = 'source/story'

/** 面板只读投影；不是作品内容，不能进入 artifact digest／export。 */
export const PANEL_INDEX_PATH = `${STORY_ROOT}/runtime/panel.index.json`

/** 身份文件；与 `source/` 同级。 */
export const WORK_FILE = 'work.json'

/** 状态目录；四份 JSON 在这里。 */
export const STATE_DIR = 'source/story/state'

/** 长篇初始化写入的外部上下文；读取方是 P2 的上下文装配。 */
export const STORY_EXTERNAL_BRIEF = `${STORY_ROOT}/brief.md`

/** 立项时写入的立意原文。 */
export const BRIEF_FILE = 'source/brief.md'

/** 两份方向文档：长期方向与近期焦点。 */
export const AUTHOR_INTENT_FILE = 'source/story/author_intent.md'
export const CURRENT_FOCUS_FILE = 'source/story/current_focus.md'

/** 大纲两份。 */
export const STORY_FRAME_FILE = `${STORY_ROOT}/outline/story_frame.md`
export const STORY_VOLUME_MAP_FILE = `${STORY_ROOT}/outline/volume_map.md`

/** book rules 两份；结构化那份是写作角色读的。 */
export const STORY_RULES_MD = `${STORY_ROOT}/book_rules.md`
export const STORY_RULES_JSON = `${STORY_ROOT}/book_rules.json`

/** 风格与同人素材；写入方是真值文件工具，读取方随对应能力接上。 */
export const STORY_STYLE_GUIDE_MD = `${STORY_ROOT}/style_guide.md`
export const STORY_PARENT_CANON_MD = `${STORY_ROOT}/parent_canon.md`
export const STORY_FANFIC_CANON_MD = `${STORY_ROOT}/fanfic_canon.md`

/** 三份 Markdown 投影；`pending_hooks.md` 也是就绪判据的一部分。 */
export const STORY_CURRENT_STATE_MD = `${STORY_ROOT}/current_state.md`
export const STORY_PENDING_HOOKS = `${STORY_ROOT}/pending_hooks.md`
export const STORY_CHAPTER_SUMMARIES_MD = `${STORY_ROOT}/chapter_summaries.md`

/** 卷摘要；故事记忆的第三个来源。 */
export const STORY_VOLUME_SUMMARIES_MD = `${STORY_ROOT}/volume_summaries.md`

/** 角色卡根目录；读取方与写入方都从这里拼路径，避免各自写字面量。 */
export const STORY_ROLES_DIR = `${STORY_ROOT}/roles`

/** 角色级别 → 磁盘目录名（规范目录，写卡落这里）。 */
export const ROLE_DIR_NAMES = { major: '主要角色', minor: '次要角色' } as const

/** 英文别名目录名；历史作品与手工写入可能落这里，读取时一并认。 */
const ROLE_DIR_ALIASES = { major: 'major', minor: 'minor' } as const

/**
 * 角色级别 → 该档位要读的目录名，规范目录在前、英文别名在后。
 * 供按档位归档的读者使用（人物档案按主要/次要分组渲染）。
 */
export const ROLE_DIRS_BY_TIER = {
  major: [ROLE_DIR_NAMES.major, ROLE_DIR_ALIASES.major],
  minor: [ROLE_DIR_NAMES.minor, ROLE_DIR_ALIASES.minor],
} as const

/**
 * 候选枚举顺序：先两个中文档、再两个英文档。
 * 与 `ROLE_DIRS_BY_TIER` 不同——那个按档位分组，这个按语言平铺，对应源工程列候选的顺序。
 */
export const ROLE_DIRS_IN_CANDIDATE_ORDER: ReadonlyArray<string> = [
  ROLE_DIR_NAMES.major,
  ROLE_DIR_NAMES.minor,
  ROLE_DIR_ALIASES.major,
  ROLE_DIR_ALIASES.minor,
]

/** 角色卡目录：中文名与英文名都认，任一目录里有一张 `.md` 就算有角色卡。 */
export const ROLE_TIER_DIRS: ReadonlyArray<string> = [
  ...ROLE_DIRS_BY_TIER.major,
  ...ROLE_DIRS_BY_TIER.minor,
].map((dir) => `${STORY_ROLES_DIR}/${dir}`)
