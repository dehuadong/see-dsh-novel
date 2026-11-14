/**
 * 阶段上下文：按工作区状态判定阶段，主动注入阶段协议与创作技能。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { AgentPresetsLike, Disposer, PluginContext } from '../../../core/types.js'
import { chapterPlanPath } from '../../../core/chapter-plan.js'
import { draftPath } from '../../../core/chapter-draft.js'
import { renderArchitectContract } from './architect.js'
import { renderWriterContract } from './writer.js'
import { renderNumberedSources, renderReviewContract } from './review.js'
import { renderPlannerContract } from './planner.js'
import { chapterReviewPath } from '../../../core/chapter-review.js'
import { revisionProposalPath } from '../../../core/revision.js'
import { workflowStartChapterSync, workflowStartedSync } from '../../../core/workflow-start.js'
import {
  STORY_FRAME_FILE,
  STORY_PENDING_HOOKS,
  STORY_RULES_JSON,
  STORY_RULES_MD,
  STORY_VOLUME_MAP_FILE,
} from '../../../core/story-paths.js'

export const STAGE_CONTEXT_NAME = 'story:stage'
export const STAGE_CONTEXT_ORDER = 90
export const CRAFT_CONTEXT_NAME = 'story:craft'
export const CRAFT_CONTEXT_ORDER = 95

export type Stage = 'proposal' | 'foundation' | 'foundation-ready' | 'plan' | 'write' | 'review' | 'chapter-done'

/** 基础设定六件套；齐了才算进入规划。 */
const FOUNDATION_FILES = [
  STORY_FRAME_FILE,
  STORY_VOLUME_MAP_FILE,
  STORY_RULES_MD,
  STORY_RULES_JSON,
  STORY_PENDING_HOOKS,
] as const

export interface StageFacts {
  stage: Stage
  title: string
  currentChapter: number
  /** 章节索引里已有章；状态损坏、currentChapter 回落 0 时仍可据此注入。 */
  hasChapters: boolean
  /** 下一章是否已有已发布正文（扣下或遗留的「已发布未结算」）。 */
  chapterPublished: boolean
  /** 下一章是否已有状态快照（扣下态会写；遗留形态没有）。 */
  chapterSnapshot: boolean
  /** 复审目标章；非 review 阶段为 0。 */
  reviewTarget: number
  /** 修订提案存在（最新已发布章的两阶段修订）。 */
  revisionProposed?: boolean
  /** 修订审稿记录存在且绑定 proposal digest。 */
  revisionReviewed?: boolean
}

const NO_CHAPTER: Pick<StageFacts, 'chapterPublished' | 'chapterSnapshot' | 'reviewTarget'> = {
  chapterPublished: false,
  chapterSnapshot: false,
  reviewTarget: 0,
}

/** 下一章是否已有发布正文（扣下或遗留的「已发布未结算」）。 */
function chapterFileExists(root: string, chapter: number): boolean {
  const prefix = `${String(chapter).padStart(4, '0')}_`
  try {
    return readdirSync(join(root, 'source/chapters')).some((file) => file.startsWith(prefix) && file.endsWith('.md'))
  } catch {
    return false
  }
}

/** 下一章是否已有状态快照（扣下态会写；遗留形态没有）。 */
function chapterSnapshotExists(root: string, chapter: number): boolean {
  return existsSync(join(root, 'source/story/snapshots', String(chapter), 'state/manifest.json'))
}

/** 章节索引里是否已有章（索引缺失、坏掉或为空都算没有）。 */
function hasIndexedChapter(root: string): boolean {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(root, 'source/chapters/index.json'), 'utf8'))
    return Array.isArray(parsed) && parsed.length > 0
  } catch {
    return false
  }
}

/** 已发布索引最大章号；索引缺失/坏掉返回 0。 */
function latestIndexChapterSync(root: string): number {
  try {
    const parsed = JSON.parse(readFileSync(join(root, 'source/chapters/index.json'), 'utf8')) as Array<{ number?: unknown }>
    return parsed.reduce((max, entry) => typeof entry.number === 'number' ? Math.max(max, entry.number) : max, 0)
  } catch {
    return 0
  }
}

/** 修订提案与修订审稿是否存在（最新章两阶段修订的路由依据）。 */
function revisionState(root: string, chapter: number): { proposed: boolean, reviewed: boolean } {
  const proposed = existsSync(join(root, revisionProposalPath(chapter)))
  if (!proposed) return { proposed: false, reviewed: false }
  try {
    const record = JSON.parse(readFileSync(join(root, chapterReviewPath(chapter)), 'utf8')) as { reviewedRevisionDigest?: unknown }
    return { proposed: true, reviewed: typeof record.reviewedRevisionDigest === 'string' }
  } catch {
    return { proposed: true, reviewed: false }
  }
}

/** 修订提案正文；缺失/坏文件返回 undefined，回落到已发布章。 */
function revisionContentSync(root: string, chapter: number): string | undefined {
  try {
    const proposal = JSON.parse(readFileSync(join(root, revisionProposalPath(chapter)), 'utf8')) as { content?: unknown }
    return typeof proposal.content === 'string' ? proposal.content : undefined
  } catch {
    return undefined
  }
}

/** 同步判定阶段：`systemPrompt.context` 的文本提供函数是同步的。 */
export function detectStage(root: string): StageFacts {
  if (!existsSync(join(root, 'work.json'))) {
    return { stage: 'proposal', title: '', currentChapter: 0, hasChapters: false, ...NO_CHAPTER }
  }
  let title = ''
  try {
    title = (JSON.parse(readFileSync(join(root, 'work.json'), 'utf8')) as { title?: string }).title ?? ''
  } catch {
    title = ''
  }
  let currentChapter = 0
  try {
    currentChapter = (JSON.parse(readFileSync(join(root, 'source/story/state/current_state.json'), 'utf8')) as { chapter?: number }).chapter ?? 0
  } catch {
    currentChapter = 0
  }
  const hasChapters = hasIndexedChapter(root)
  if (!FOUNDATION_FILES.every((file) => existsSync(join(root, file)))) {
    return { stage: 'foundation', title, currentChapter, hasChapters, ...NO_CHAPTER }
  }
  const nextChapter = currentChapter + 1
  const chapterPublished = chapterFileExists(root, nextChapter)
  const chapterSnapshot = chapterSnapshotExists(root, nextChapter)
  const revisionChapter = latestIndexChapterSync(root)
  const revision = revisionChapter > 0 ? revisionState(root, revisionChapter) : { proposed: false, reviewed: false }
  const startChapter = workflowStartChapterSync(root)
  // 已发布章有待复审的 start：恢复/修订后的复审目标；先于 chapter-done 判断。
  if (!revision.proposed && startChapter !== null && startChapter <= currentChapter
    && chapterFileExists(root, startChapter)
    && !existsSync(chapterReviewPath(startChapter))) {
    return {
      stage: 'review',
      title,
      currentChapter,
      hasChapters,
      chapterPublished,
      chapterSnapshot,
      reviewTarget: startChapter,
    }
  }
  if (revision.proposed && revision.reviewed) {
    return {
      stage: 'chapter-done',
      title,
      currentChapter,
      hasChapters,
      chapterPublished,
      chapterSnapshot,
      reviewTarget: revisionChapter,
      revisionProposed: true,
      revisionReviewed: true,
    }
  }
  if (revision.proposed) {
    return {
      stage: 'review',
      title,
      currentChapter,
      hasChapters,
      chapterPublished,
      chapterSnapshot,
      reviewTarget: revisionChapter,
      revisionProposed: true,
      revisionReviewed: false,
    }
  }
  const review = chapterReviewPath(nextChapter)
  if (existsSync(join(root, review))) {
    return { stage: 'chapter-done', title, currentChapter, hasChapters, chapterPublished, chapterSnapshot, reviewTarget: 0 }
  }
  if (!workflowStartedSync(root, nextChapter)) {
    return { stage: 'foundation-ready', title, currentChapter, hasChapters, chapterPublished, chapterSnapshot, reviewTarget: 0 }
  }
  const nextPlan = chapterPlanPath(nextChapter)
  if (!existsSync(join(root, nextPlan))) {
    return { stage: 'plan', title, currentChapter, hasChapters, chapterPublished, chapterSnapshot, reviewTarget: 0 }
  }
  const hasDraft = existsSync(join(root, draftPath(nextChapter)))
  if (!chapterPublished && !hasDraft) {
    return { stage: 'write', title, currentChapter, hasChapters, chapterPublished, chapterSnapshot, reviewTarget: 0 }
  }
  return { stage: 'review', title, currentChapter, hasChapters, chapterPublished, chapterSnapshot, reviewTarget: nextChapter }
}

/** 阶段协议：只写做什么、按什么顺序调什么、产出什么。 */
function renderStageBase(facts: StageFacts): string {
  const next = facts.currentChapter + 1
  const header = `## 当前阶段：${{ proposal: '提案', foundation: '基础设定', 'foundation-ready': '等待开工', plan: '章前规划', write: '正文写作', review: '章后审阅', 'chapter-done': '本章完成' }[facts.stage]}`
  const common = '本阶段的创作方法已随上下文提供；不需要再调用技能工具加载。'
  switch (facts.stage) {
    case 'proposal':
      return [
        header,
        '目标：把作者的一句话创作意图收敛成一张可确认的立项卡。',
        '1. 只问缺的关键信息（标题、方向、题材、平台、语言、目标章数、单章字数），一次问一个。',
        '2. 信息够了就调 `story_propose`（顶层 title／summary／instruction 必填；createBook 带作品标题与规模，作者给了章长区间就填 min/max）。',
        '3. 允许：落盘并进入基础设定；退回：只问想改哪一处后重新提案；取消：等作者重新开口。',
        common,
      ].join('\n')
    case 'foundation':
      return [
        header,
        '目标：按四段把基础设定写全；写全后停在这里，等作者发起 workflow start。',
        '1. `story_foundation_outline`：提交 storyFrame 与 volumeMap。',
        '2. `story_foundation_details`：入参带上第 1 步的 storyFrame／volumeMap，提交 bookRules、bookRulesData 与 pendingHooks。',
        '3. `story_foundation_cast_index`：入参带上 storyFrame／volumeMap／bookRules，只提交姓名与主次级别。',
        '4. `story_foundation_cast_documents`：为第 3 步的每个人提交一张卡（当下动机、已知信息、关系压力、能力边界，中文约 150–250 字／英文 80–120 词）。',
        '基础设定写全后只是 `foundation-ready`；不要自动规划或写正文。',
        common,
      ].join('\n')
    case 'foundation-ready':
      return [
        header,
        '目标：基础设定已齐，等待作者发起一章的 workflow start；现在不规划、不写正文。',
        '1. 如果作者只是问候/讨论，正常回答，不改作品。',
        '2. 只有作者明确要求开始写下一章（panel.confirm 或命令）后，才进入 plan/write；workflow start 由作者确认写入。',
        '3. 不要自行调用 `story_plan_chapter`／`story_write_chapter`；没有 start 时它们会拒绝。',
        common,
      ].join('\n')
    case 'plan':
      return [
        header,
        `目标：规划第 ${next} 章。`,
        '1. 调 `story_context_candidates`（purpose=planner，instruction 用本轮作者指令）。',
        '2. 对 tasks 里的每个任务用原生 `subagent` 派发 composer；mode=complete 时跳过。拿回 {memory, role, state, storyFrame, volumeMap} 的 id 集合。',
        '3. 调 `story_context_package`（purpose=planner，instruction 与上一步相同，selection=上一步的 id 集合）。若返回 compressionTask：对每个 chunk 派 subagent 压缩，合并后超预算重压一次；把最终文本作为 compressedText 重调 package。',
        `4. 按 package 写 memo（goal / body / threadRefs），再调 \`story_plan_chapter\` 落盘第 ${next} 章；plannerInputs 由宿主从 planner 包读取。`,
        '5. 本章正文已存在（重开保留了旧稿）时：规划落盘后停；作者要求整章重写时用 `story_revise_chapter`（rewrite／rework），不走首次写作入口。',
        '只规划下一章；该章已有章纲时不覆盖。',
        '规划落盘后即停，不自动写正文；正文仍属于同一个 workflow start，由当前阶段继续。',
        common,
      ].join('\n')
    case 'review': {
      const target = facts.reviewTarget || next
      if (facts.revisionProposed) {
        return [
          header,
          `目标：审第 ${target} 章的修订提案。`,
          '1. 派审稿子代理读注入的编号来源（提案正文），按写作方法审稿；拿回 observations 与 summary。',
          '2. 每条观察给出 code、summary、assessment 与 sourceRefs；只能引用注入的来源。',
          `3. 调 \`story_review_chapter\`（chapter=${target}，revisionDigest）落盘；不要审已发布旧正文。`,
          '4. 审稿落盘后进入修订提交：settler 增量 → `story_commit_revision` C1 → state-check → C2；不要调用 resettle。',
          '修订提案未提交前不要开下一章。',
          common,
        ].join('\n')
      }
      return [
        header,
        `目标：审第 ${target} 章的首版正文。`,
        '1. 派审稿子代理读章节文档与章纲，按注入的写作方法审稿；拿回 observations 与 summary 后落盘。',
        '2. 每条观察给出 code、summary、assessment（issue／resolved／observation／unavailable）与 sourceRefs。',
        '3. 引文只能引用注入的编号来源（sourceId 加行号或逐字 quote）；没有证据的条目不提交。',
        `4. 调 \`story_review_chapter\` 落盘第 ${target} 章的审稿记录。`,
        '5. 审稿不通过转修订时：spot-fix 按下方编号来源选范围并交 `ranges`／`replacements`（空串删段，非空按换行分行），其它模式交整段 content，可选用唯一 targetText。',
        '同一章只审一次；修订后必须重新审稿。',
        '若本章是「重开保留的旧稿」，先问作者是否改稿：改稿走 `story_revise_chapter`，不要直接审旧稿；直接审只作确认现有正文。',
        '审稿落盘后即停；不自动修订、结算或开下一章。',
        common,
      ].join('\n')
    }
    case 'write':
      return [
        header,
        `目标：写第 ${next} 章的首版正文。`,
        '1. 调 `story_context_candidates`（purpose=writer）。',
        '2. 对 tasks 里的每个任务用原生 `subagent` 派发 composer；mode=complete 时跳过。拿回 {memory, role, state, storyFrame, volumeMap} 的 id 集合。',
        '3. 调 `story_context_package`（purpose=writer，selection=上一步的 id 集合）。若返回 compressionTask：对每个 chunk 派 subagent 压缩，合并后超预算重压一次；把最终文本作为 compressedText 重调 package；package 与 trace 会落盘。',
        `4. 读 \`source/story/runtime/chapter-${String(next).padStart(4, '0')}.intent.md\`、plan 与 context 作为章纲与上下文，派 writer 写正文。`,
        '5. 调 `story_write_chapter`（chapter、title、content）落盘；字数偏差只报告，不据此拒稿。',
        '已发布章拒绝写草稿；草稿已有审稿记录时走 story_revise_chapter。',
        '草稿写完后即停，不自动审稿或进入下一章。',
        common,
      ].join('\n')
    case 'chapter-done':
      if (facts.revisionReviewed) {
        return [
          header,
          `目标：第 ${facts.reviewTarget} 章的修订提案已审稿，提交修订事务。`,
          '1. 派 settler 子代理按修订提案正文与审稿记录产出 postSettlement／factOps／hookOps／newHookCandidates 与七字段摘要。',
          `2. 调 \`story_commit_revision\`（chapter=${facts.reviewTarget}，revisionDigest，增量）生成修订结算提案（C1），只写 \`.drafts/revision-NNNN.settlement.json\`。`,
          '3. 派 state-check 子代理读结算提案、修订提案正文、story_frame 与 book_rules，按结算判据只回 {reconciliationRequired, reportMarkdown}。',
          `4. 一致时带 validation={proposalDigest, outcome: consistent, reportMarkdown} 和 proposalDigest 重调 \`story_commit_revision\`（C2）一次提交正文/索引/artifact/状态/快照；第一次对账不通过时按报告重派 settler 再走 C1/C2。`,
          '修订单不要先调 `story_resettle_chapter`；扣下/恢复仍用 resettle。',
          common,
        ].join('\n')
      }
      return [
        header,
        `目标：第 ${next} 章审稿已落盘，本章 workflow 结束；不要自动结算或开下一章。`,
        '1. 如果作者只是问候/讨论，正常回答，不改作品。',
        '2. 作者要求结算本章时，按两阶段走：',
        '   a. 派 settler 子代理按正文与审稿记录产出 postSettlement／factOps／hookOps／newHookCandidates 与七字段摘要。',
        `   b. 用这份增量调 \`story_settle_chapter\`（不带 validation）生成结算提案：它只写 \`.drafts/settlement-${String(next).padStart(4, '0')}.json\`，此时不发布。`,
        '   c. 派 state-check 子代理读提案文件、本章正文（`.drafts/chapter-NNNN.md`）、`source/story/outline/story_frame.md` 与 `source/story/book_rules.md`，按下面的判据只回 {reconciliationRequired, reportMarkdown}；结算前不要调用 `story_state_check`（本章未结算，会因前置被拒）。',
        '   d. 记录本章用量（可选）：先用 `story_telemetry` 找到本章 writer／review 的直接子会话 id，再调 `story_record_chapter_usage`；结算会写索引 `tokenUsage` 并删除 usage 文件。id 以本章委派回执为准；拿不到用量就跳过。',
        '   e. 一致时带 validation={proposalDigest, outcome: consistent, reportMarkdown} 重调 `story_settle_chapter` 提交：章节、四份状态 JSON、三份投影、快照、索引、artifact 与 active 一次落盘。',
        '   f. 需要重算时带 outcome: reconciliation-required 提交：工具会把报告记进提案并拒绝；把提案文件的 failureReport 原文交给 settler 重做一次，再生成提案、再对账、再提交。第二次仍要求重算时，工具会发布章节但状态停在上一章，必须告诉作者修复后用 `story_resettle_chapter` 重建。',
        '   g. 校验子代理失败或不可用时带 outcome: unavailable 提交：同样发布章节但不推进状态，观察记为 state-validation-unavailable。',
        '   判据：只有换一份真值投影（truth projection）能消解不一致时 reconciliationRequired 才为 true；正文或权威之间的矛盾只作观察、不授权再次结算；superseded 伏笔按 notes 与撤回权威核对，不要求原前提在正文发生；按作品语言作答。',
        ...(facts.chapterPublished
          ? [facts.chapterSnapshot
            ? `本章已发布但状态未推进（上次结算被扣下）：用 \`story_resettle_chapter\` 按第 ${next - 1} 章快照重建；不要再次结算，也不要重开上一章。`
            : '本章已发布但状态未推进且缺快照（旧工作区遗留）：先运行 `story_recover`，按它的人工步骤处理。']
          : []),
        '3. 作者要修订本章时：先问清要改哪里与模式（polish／rewrite／rework／anti-detect／spot-fix）。spot-fix 按下方编号正文选范围，派 reviser 子代理产出每段替换文本（空串删段，非空按换行分行），调 `story_revise_chapter`（ranges／replacements 与整段 content）；其它模式交整段 content，可选用唯一 targetText。修订会作废旧审稿，必须重新审稿后才能再停。',
        '4. 作者要重开或恢复旧版本时：先调 `story_chapter_versions` 列归档；恢复旧版用 `story_reopen_chapter` 带 versionId，任意章可用、只换正文、清运行时（保留章纲）、写索引人工编辑观察与本章复审 start，不动状态；重开回退不带 versionId，仅限最新已发布且最后已结算章，状态从第 N-1 章快照回退（facts/hooks/摘要一起回退）；更晚章已发布或缺 N-1 快照/本章快照、索引条目、artifact 时拒绝。重开后回到章前规划；改稿走 `story_revise_chapter`（写入口拒已发布章），不要直接审旧稿。',
        '5. 作者要删掉最新章时：调 `story_delete_chapter`；原文进 `chapters/.trash/`，状态回滚到上一章。',
        '6. 作者要求核对状态时：派 state-check 子代理读本章正文、当前状态与投影、上一章快照与权威文档，提交 `reconciliationRequired` 与证据报告，再调 `story_state_check`；判据同上；findings 只回作者，不自动重结算。',
        '7. 下一章是后续能力/作者动作；不要自行开始。',
        common,
      ].join('\n')
  }
}

/** 重算入口：只在已开过章的工作区注入。 */
const CHAPTER_REPAIR = [
  '## 重新结算（重算）',
  '作者在修订、恢复正文或重开回退后要求「重新结算／同步状态」时：',
  '1. 先按需复审（修订、恢复正文或重开都会写或替换本章 workflow start，复审会消费它；没有复审就重算会挡住下一章的 start）。',
  '2. 派 settler 前把第 N-1 章基线原文（`source/story/snapshots/<N-1>/state/` 的四份 JSON 与三份快照投影）贴进 settler 提示并声明为唯一基线；`source/story/state/` 的当前投影只作参考。',
  '3. 用增量调 `story_resettle_chapter`（不带 validation）生成重算提案；派 state-check 子代理读提案、已发布正文、`story_frame` 与 `book_rules` 对账，按结算同一套判据只回 {reconciliationRequired, reportMarkdown}；结算前不要调用 `story_state_check`。',
  '4. 一致时带 validation 提交；需要重算时工具记录报告并拒绝，把提案文件的 failureReport 交给 settler 重做一次再提案、再对账；第二次仍不通过或校验不可用时工具拒绝且不写任何作品文件。',
  '5. 只支持最新章；重算刷新第 N 章快照，不改正文、章节索引与 workflow-start；重开已把状态回退到 N-1，重算基线仍是 `snapshots/<N-1>`；已结算章不要调 `story_settle_chapter`。',
].join('\n')

/** 阶段协议：基础协议 + 已开过章时的重算入口。 */
export function renderStageProtocol(facts: StageFacts): string {
  const base = renderStageBase(facts)
  const hasChapterWork = facts.stage !== 'proposal' && facts.stage !== 'foundation'
    && (facts.currentChapter >= 1 || facts.hasChapters)
  return hasChapterWork ? `${base}\n${CHAPTER_REPAIR}` : base
}

/** 本阶段主动加载的创作技能；空数组表示不注入。 */
export function craftSkillsFor(stage: Stage): string[] {
  if (stage === 'proposal') return ['story-proposal']
  if (stage === 'review' || stage === 'chapter-done') return ['story-review']
  if (stage === 'foundation' || stage === 'write') return ['longform-writing']
  return []
}

/** 读取技能正文与 references；缺失时返回空串而不是抛错。 */
export function renderCraft(packageRoot: string, stage: Stage): string {
  const parts: string[] = []
  for (const skill of craftSkillsFor(stage)) {
    const dir = join(packageRoot, 'skills', skill)
    try {
      parts.push(`# 创作方法（${skill}）`, '', readFileSync(join(dir, 'SKILL.md'), 'utf8').trim())
    } catch {
      continue
    }
    const references = join(dir, 'references')
    if (existsSync(references)) {
      for (const file of readdirSync(references).filter((name) => name.endsWith('.md')).sort()) {
        parts.push('', `## 参考：${file.replace(/\.md$/u, '')}`, '', readFileSync(join(references, file), 'utf8').trim())
      }
    }
  }
  return parts.join('\n')
}

/** 注册阶段协议与创作技能两个上下文条目。 */
export function installStageContext(ctx: PluginContext, packageRoot: string, presetId: string): Disposer {
  const presets = (): AgentPresetsLike | undefined => ctx.get('agentPresets') as AgentPresetsLike | undefined
  const forAgent = (assembly: { agent?: { ctx?: unknown, session: unknown } }): StageFacts | undefined => {
    const agent = assembly.agent
    if (agent === undefined || agent.ctx === undefined) return undefined
    if (presets()?.composedPreset(agent.ctx) !== presetId) return undefined
    try {
      return detectStage(ctx.workingDirectory.get(agent.session as never))
    } catch {
      return undefined
    }
  }
  const disposeStage = ctx.systemPrompt.context({
    name: STAGE_CONTEXT_NAME,
    order: STAGE_CONTEXT_ORDER,
    interpolate: false,
    required: true,
    text: (assembly) => {
      const facts = forAgent(assembly)
      if (facts === undefined) return ''
      if (facts.stage !== 'foundation' && facts.stage !== 'write' && facts.stage !== 'review' && facts.stage !== 'plan' && facts.stage !== 'chapter-done') return renderStageProtocol(facts)
      let root = ''
      try {
        const agent = assembly.agent as { session: unknown } | undefined
        if (agent !== undefined) root = ctx.workingDirectory.get(agent.session as never)
      } catch {
        root = ''
      }
      if (root === '') return renderStageProtocol(facts)
      const reviewChapter = facts.revisionProposed ? facts.reviewTarget : (facts.reviewTarget || facts.currentChapter + 1)
      const revisionContent = facts.revisionProposed ? revisionContentSync(root, facts.reviewTarget) : undefined
      const contract = facts.stage === 'foundation'
        ? renderArchitectContract(root)
        : facts.stage === 'write'
          ? renderWriterContract(root)
          : facts.stage === 'review'
            ? renderReviewContract(root, reviewChapter, revisionContent)
            : facts.stage === 'chapter-done'
              ? renderNumberedSources(root, reviewChapter, revisionContent)
              : renderPlannerContract(root)
      return `${renderStageProtocol(facts)}\n\n${contract}`
    },
  })
  const disposeCraft = ctx.systemPrompt.context({
    name: CRAFT_CONTEXT_NAME,
    order: CRAFT_CONTEXT_ORDER,
    interpolate: false,
    required: true,
    text: (assembly) => {
      const facts = forAgent(assembly)
      return facts === undefined ? '' : renderCraft(packageRoot, facts.stage)
    },
  })
  return (): void => {
    disposeCraft()
    disposeStage()
  }
}
