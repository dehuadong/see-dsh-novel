/**
 * 阶段上下文：按工作区状态判定阶段，主动注入阶段协议与创作技能。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { AgentPresetsLike, Disposer, PluginContext } from '../../../core/types.js'
import type { WorkLanguage } from '../../../core/work.js'
import { chapterPlanPath } from '../../../core/chapter-plan.js'
import { draftPath } from '../../../core/chapter-draft.js'
import { isFoundationApproved } from '../../../core/foundation-approval.js'
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
  /** 作品语言；无 work.json（proposal）时为 zh。 */
  language?: WorkLanguage
  currentChapter: number
  /** 作品级基础设定确认是否有效；只在 foundation-ready 判定。 */
  foundationApproved?: boolean
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
    return { stage: 'proposal', title: '', language: 'zh', currentChapter: 0, hasChapters: false, ...NO_CHAPTER }
  }
  let title = ''
  let language: WorkLanguage = 'zh'
  try {
    const work = JSON.parse(readFileSync(join(root, 'work.json'), 'utf8')) as { title?: string, language?: WorkLanguage }
    title = work.title ?? ''
    language = work.language === 'en' ? 'en' : 'zh'
  } catch {
    title = ''
    language = 'zh'
  }
  let currentChapter = 0
  try {
    currentChapter = (JSON.parse(readFileSync(join(root, 'source/story/state/current_state.json'), 'utf8')) as { chapter?: number }).chapter ?? 0
  } catch {
    currentChapter = 0
  }
  const hasChapters = hasIndexedChapter(root)
  if (!FOUNDATION_FILES.every((file) => existsSync(join(root, file)))) {
    return { stage: 'foundation', title, language, currentChapter, hasChapters, ...NO_CHAPTER }
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
      language,
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
      language,
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
      language,
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
    return { stage: 'chapter-done', title, language, currentChapter, hasChapters, chapterPublished, chapterSnapshot, reviewTarget: 0 }
  }
  if (!workflowStartedSync(root, nextChapter)) {
    return { stage: 'foundation-ready', title, language, currentChapter, hasChapters, chapterPublished, chapterSnapshot, reviewTarget: 0, foundationApproved: isFoundationApproved(root) }
  }
  const nextPlan = chapterPlanPath(nextChapter)
  if (!existsSync(join(root, nextPlan))) {
    return { stage: 'plan', title, language, currentChapter, hasChapters, chapterPublished, chapterSnapshot, reviewTarget: 0 }
  }
  const hasDraft = existsSync(join(root, draftPath(nextChapter)))
  if (!chapterPublished && !hasDraft) {
    return { stage: 'write', title, language, currentChapter, hasChapters, chapterPublished, chapterSnapshot, reviewTarget: 0 }
  }
  return { stage: 'review', title, language, currentChapter, hasChapters, chapterPublished, chapterSnapshot, reviewTarget: nextChapter }
}

/** 阶段协议：只写做什么、按什么顺序调什么、产出什么。 */
function renderStageBase(facts: StageFacts): string {
  if (facts.stage === 'proposal') return renderStageBaseZh(facts)
  return facts.language === 'en' ? renderStageBaseEn(facts) : renderStageBaseZh(facts)
}

function renderStageBaseZh(facts: StageFacts): string {
  const next = facts.currentChapter + 1
  const header = `## 当前阶段：${{ proposal: '提案', foundation: '基础设定', 'foundation-ready': '等待开工', plan: '章前规划', write: '正文写作', review: '章后审阅', 'chapter-done': '本章完成' }[facts.stage]}`
  const common = '本阶段强制注入的创作方法必须使用；其它方法只在确有需要时加载，不要机械加载无关方法。'
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
        facts.foundationApproved === true
          ? '目标：基础设定已由作者确认；等作者发起一章的 workflow start。'
          : '目标：基础设定已齐；开章前先确认基础设定，再由作者开始一章的 workflow start。',
        '1. 如果作者只是问候/讨论，正常回答，不改作品。',
        facts.foundationApproved === true
          ? '2. 基础设定已由作者确认；等作者用 `/story-write` 开始下一章。'
          : '2. 开章前先确认基础设定：作者用 `/story-approve`（或面板「确认基础设定」）；没有有效确认时 `/story-write` 会拒绝。',
        '3. 确认后由作者用 `/story-write` 开始下一章；workflow start 由作者确认写入。',
        '4. 不要自行调用 `story_plan_chapter`／`story_write_chapter`；没有 start 时它们会拒绝。',
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
        '只规划下一章；无作者附言且已有章纲时复用，不覆盖；作者附言存在时重规划并覆盖。',
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
        '同一章可以重审；再审覆盖记录并替换索引观察；修订后必须重新审稿。',
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
        `4. 读 \`source/story/runtime/chapter-${String(next).padStart(4, '0')}.intent.md\`、plan 与 context 作为章纲与上下文，派 writer 写正文；派发提示里写明：writer 调 \`story_write_chapter\`（chapter、title、content）落盘，只回四行摘要：\`标题：\`、\`字数：\`、\`草稿：\`、\`注意：\`；不要回传正文。`,
        '5. 核对 writer 摘要的标题、字数、草稿路径，并用 `glob` 确认草稿存在；不读正文，不要把正文复述到主会话；字数偏差只报告，不据此拒稿。',
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
        '2. 只有作者已用 `/story-settle` 或面板「结算本章」确认后，才按两阶段走；不要在作者未确认时自行开始：',
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

function renderStageBaseEn(facts: StageFacts): string {
  const next = facts.currentChapter + 1
  const header = `## Current stage: ${{ proposal: 'Proposal', foundation: 'Foundation setup', 'foundation-ready': 'Ready to start', plan: 'Chapter planning', write: 'Chapter writing', review: 'Chapter review', 'chapter-done': 'Chapter complete' }[facts.stage]}`
  const common = 'The craft methods injected for this stage must be used; load other skills only when they are genuinely needed, and do not load unrelated methods mechanically.'
  switch (facts.stage) {
    case 'foundation':
      return [
        header,
        'Goal: complete the foundation in four steps; when complete, stop here and wait for the author to start a workflow.',
        '1. `story_foundation_outline`: submit storyFrame and volumeMap.',
        '2. `story_foundation_details`: pass the storyFrame/volumeMap from step 1 and submit bookRules, bookRulesData and pendingHooks.',
        '3. `story_foundation_cast_index`: pass storyFrame/volumeMap/bookRules and submit only names and major/minor tiers.',
        '4. `story_foundation_cast_documents`: submit one card per person from step 3 (current motive, known information, relationship pressure, capability boundaries; about 150–250 Chinese characters / 80–120 English words).',
        'A completed foundation is only `foundation-ready`; do not plan or write prose automatically.',
        common,
      ].join('\n')
    case 'foundation-ready':
      return [
        header,
        facts.foundationApproved === true
          ? 'Goal: the foundation is approved by the author; wait for the author to start one chapter.'
          : 'Goal: the foundation is complete; confirm the foundation first, then let the author start a chapter.',
        '1. If the author is only greeting or discussing, answer normally and do not change the work.',
        facts.foundationApproved === true
          ? '2. The foundation is already approved by the author; wait for the author to start the next chapter with `/story-write`.'
          : '2. Confirm the foundation first: the author uses `/story-approve` (or the panel confirm action); `/story-write` rejects without a valid approval.',
        '3. After confirmation the author starts the next chapter with `/story-write`; the workflow start is written by author confirmation.',
        '4. Do not call `story_plan_chapter`/`story_write_chapter` on your own; they reject without a start.',
        common,
      ].join('\n')
    case 'plan':
      return [
        header,
        `Goal: plan chapter ${next}.`,
        "1. Call `story_context_candidates` (purpose=planner, instruction = this round's author instruction).",
        '2. For each task, dispatch a composer through the native `subagent`; skip when mode=complete. Take back the id sets for {memory, role, state, storyFrame, volumeMap}.',
        '3. Call `story_context_package` (purpose=planner, same instruction as the previous step, selection = the previous id sets). If it returns a compressionTask: dispatch a subagent per chunk to compress, merge, re-compress once if over budget, and call package again with the final text as compressedText.',
        `4. Write the memo (goal / body / threadRefs) from the package, then call \`story_plan_chapter\` to persist chapter ${next}; the host reads plannerInputs from the planner package.`,
        '5. When the chapter prose already exists (a reopen kept the old draft): stop after the plan is persisted; when the author asks for a full rewrite, use `story_revise_chapter` (rewrite/rework), not the first-writing entry.',
        'Plan only the next chapter; reuse an existing plan when there is no author note, and replan/overwrite when the author note exists.',
        'Stop once the plan is persisted; do not write prose automatically. The prose still belongs to the same workflow start and continues in the current stage.',
        common,
      ].join('\n')
    case 'review': {
      const target = facts.reviewTarget || next
      if (facts.revisionProposed) {
        return [
          header,
          `Goal: review the revision proposal for chapter ${target}.`,
          '1. Dispatch a review subagent to read the injected numbered sources (the proposal body) and review per the craft method; take back observations and summary.',
          '2. Each observation gives code, summary, assessment and sourceRefs; cite only injected sources.',
          `3. Call \`story_review_chapter\` (chapter=${target}, revisionDigest) to persist; do not review the published old prose.`,
          '4. After the review persists, enter revision commit: settler delta → `story_commit_revision` C1 → state-check → C2; do not call resettle.',
          'Do not start the next chapter before the revision proposal is committed.',
          common,
        ].join('\n')
      }
      return [
        header,
        `Goal: review the first-version prose of chapter ${target}.`,
        '1. Dispatch a review subagent to read the chapter document and the chapter plan, review per the injected craft method; take back observations and summary, then persist.',
        '2. Each observation gives code, summary, assessment (issue/resolved/observation/unavailable) and sourceRefs.',
        '3. Quotes may cite only the injected numbered sources (sourceId plus line numbers or an exact quote); do not submit entries without evidence.',
        `4. Call \`story_review_chapter\` to persist the review record for chapter ${target}.`,
        '5. When the review fails and moves to revision: spot-fix selects ranges from the numbered sources below and passes `ranges`/`replacements` (an empty string deletes a range, a non-empty one splits by line); other modes pass the whole content, optionally with a unique targetText.',
        'The same chapter may be re-reviewed; a re-review overwrites the record and replaces the index observations; after revision the chapter must be reviewed again.',
        'If this chapter is a "reopen-kept old draft", first ask the author whether to revise: revision goes through `story_revise_chapter`, do not review the old prose directly; a direct review only confirms the existing prose.',
        'Stop after the review persists; do not revise, settle, or start the next chapter automatically.',
        common,
      ].join('\n')
    }
    case 'write':
      return [
        header,
        `Goal: write the first-version prose of chapter ${next}.`,
        '1. Call `story_context_candidates` (purpose=writer).',
        '2. For each task, dispatch a composer through the native `subagent`; skip when mode=complete. Take back the id sets for {memory, role, state, storyFrame, volumeMap}.',
        '3. Call `story_context_package` (purpose=writer, selection = the previous id sets). If it returns a compressionTask: dispatch a subagent per chunk to compress, merge, re-compress once if over budget, and call package again with the final text as compressedText; the package and trace are persisted.',
        `4. Read \`source/story/runtime/chapter-${String(next).padStart(4, '0')}.intent.md\`, the plan and the context as the chapter plan and context, and dispatch a writer to write the prose; in the dispatch prompt, require the writer to call \`story_write_chapter\` (chapter, title, content) to persist and return only four lines: \`Title:\`, \`Words:\`, \`Draft:\`, \`Notes:\`; do not return the prose.`,
        '5. Check the writer summary (title, word count, draft path) and use `glob` to confirm the draft exists; do not read the prose, do not repeat it in the main conversation; report word-count deviation only, do not reject on it.',
        'A published chapter rejects a draft write; when a draft already has a review record, go through story_revise_chapter.',
        'Stop after the draft is written; do not review or start the next chapter automatically.',
        common,
      ].join('\n')
    case 'chapter-done':
      if (facts.revisionReviewed) {
        return [
          header,
          `Goal: the revision proposal for chapter ${facts.reviewTarget} has been reviewed; commit the revision transaction.`,
          '1. Dispatch a settler subagent to produce postSettlement/factOps/hookOps/newHookCandidates and the seven-field summary from the revision proposal body and the review record.',
          `2. Call \`story_commit_revision\` (chapter=${facts.reviewTarget}, revisionDigest, delta) to generate the revision settlement proposal (C1); it writes only \`.drafts/revision-NNNN.settlement.json\`.`,
          '3. Dispatch a state-check subagent to read the settlement proposal, the revision proposal body, story_frame and book_rules, and return only {reconciliationRequired, reportMarkdown} under the settlement criteria.',
          `4. When consistent, call \`story_commit_revision\` again (C2) with validation={proposalDigest, outcome: consistent, reportMarkdown} and proposalDigest to commit prose/index/artifact/state/snapshot in one transaction; when the first reconciliation fails, dispatch the settler again with the report and repeat C1/C2.`,
          'Do not call `story_resettle_chapter` for a revision order; held/recovery still use resettle.',
          common,
        ].join('\n')
      }
      return [
        header,
        `Goal: chapter ${next} review is persisted and this chapter's workflow ends; do not settle or start the next chapter automatically.`,
        '1. If the author is only greeting or discussing, answer normally and do not change the work.',
        '2. Only after the author confirms with `/story-settle` or the panel "settle this chapter" action, follow the two phases; do not start without that confirmation:',
        '   a. Dispatch a settler subagent to produce postSettlement/factOps/hookOps/newHookCandidates and the seven-field summary from the prose and the review record.',
        `   b. Call \`story_settle_chapter\` (without validation) with that delta to generate the settlement proposal: it writes only \`.drafts/settlement-${String(next).padStart(4, '0')}.json\` and publishes nothing yet.`,
        "   c. Dispatch a state-check subagent to read the proposal file, this chapter's prose (`.drafts/chapter-NNNN.md`), `source/story/outline/story_frame.md` and `source/story/book_rules.md`, and return only {reconciliationRequired, reportMarkdown} under the criteria below; do not call `story_state_check` before settlement (the chapter is not settled and the precondition rejects it).",
        "   d. Record this chapter's usage (optional): call `story_telemetry` to find the direct child session ids of this chapter's writer/review, then call `story_record_chapter_usage`; settlement writes the index `tokenUsage` and deletes the usage file. Use the delegation receipts for this chapter; skip when usage is unavailable.",
        '   e. When consistent, call `story_settle_chapter` again with validation={proposalDigest, outcome: consistent, reportMarkdown} to commit: the chapter, four state JSON files, three projections, the snapshot, the index, the artifact and active in one transaction.',
        "   f. When recompute is needed, submit with outcome: reconciliation-required: the tool records the report in the proposal and rejects; hand the proposal file's failureReport to the settler to redo once, then propose, reconcile and submit again. If the second pass still requires recompute, the tool publishes the chapter but leaves the state on the previous chapter; tell the author to repair it with `story_resettle_chapter`.",
        '   g. When the validation subagent fails or is unavailable, submit with outcome: unavailable: the chapter is published but the state is not advanced, and the observation is recorded as state-validation-unavailable.',
        '   Criteria: reconciliationRequired is true only when a different truth projection can resolve the mismatch; contradictions in the prose or between authorities remain observations and do not authorize another settlement; verify superseded hooks against notes and the withdrawal authority rather than requiring the original premise to occur in the chapter; answer in the work language.',
        ...(facts.chapterPublished
          ? [facts.chapterSnapshot
            ? `This chapter is published but the state did not advance (the last settlement was held): rebuild with \`story_resettle_chapter\` from the chapter ${next - 1} snapshot; do not settle again and do not reopen the previous chapter.`
            : 'This chapter is published but the state did not advance and the snapshot is missing (an old workspace): run `story_recover` first and follow its manual steps.']
          : []),
        '3. When the author wants to revise this chapter: first clarify what to change and the mode (polish/rewrite/rework/anti-detect/spot-fix). spot-fix selects ranges from the numbered prose below and dispatches a reviser subagent to produce each replacement (an empty string deletes a range, a non-empty one splits by line), then calls `story_revise_chapter` (ranges/replacements and the whole content); other modes pass the whole content, optionally with a unique targetText. Revision invalidates the old review and the chapter must be reviewed again before stopping.',
        "4. When the author wants to reopen or restore an old version: first call `story_chapter_versions` to list the archive; restore with `story_reopen_chapter` and a versionId, available for any chapter, replacing only the prose, clearing runtime (keeping the plan), writing the index manual-edit observation and this chapter's review start, without touching the state; reopen-rollback without a versionId only applies to the latest published and last settled chapter, rolling the state back from the chapter N-1 snapshot (facts/hooks/summaries together); reject when a later chapter is published, or the N-1 snapshot/this chapter snapshot, the index entry or the artifact is missing. After reopening, return to chapter planning; revise through `story_revise_chapter` (the write entry rejects a published chapter) and do not review the old prose directly.",
        '5. When the author wants to delete the latest chapter: call `story_delete_chapter`; the prose moves to `chapters/.trash/` and the state rolls back to the previous chapter.',
        "6. When the author asks to check the state: dispatch a state-check subagent to read this chapter's prose, the current state and projections, the previous chapter snapshot and the authority documents, submit `reconciliationRequired` and an evidence report, then call `story_state_check`; the criteria are the same; findings go only to the author and never trigger an automatic resettle.",
        '7. The next chapter is a later capability/author action; do not start it on your own.',
        common,
      ].join('\n')
    default:
      // proposal 没有作品身份，协议恒中文。
      return renderStageBaseZh(facts)
  }
}

/** 重算入口：只在已开过章的工作区注入。 */
const CHAPTER_REPAIR_ZH = [
  '## 重新结算（重算）',
  '作者在修订、恢复正文或重开回退后要求「重新结算／同步状态」时：',
  '1. 先按需复审（修订、恢复正文或重开都会写或替换本章 workflow start，复审会消费它；没有复审就重算会挡住下一章的 start）。',
  '2. 派 settler 前把第 N-1 章基线原文（`source/story/snapshots/<N-1>/state/` 的四份 JSON 与三份快照投影）贴进 settler 提示并声明为唯一基线；`source/story/state/` 的当前投影只作参考。',
  '3. 用增量调 `story_resettle_chapter`（不带 validation）生成重算提案；派 state-check 子代理读提案、已发布正文、`story_frame` 与 `book_rules` 对账，按结算同一套判据只回 {reconciliationRequired, reportMarkdown}；结算前不要调用 `story_state_check`。',
  '4. 一致时带 validation 提交；需要重算时工具记录报告并拒绝，把提案文件的 failureReport 交给 settler 重做一次再提案、再对账；第二次仍不通过或校验不可用时工具拒绝且不写任何作品文件。',
  '5. 只支持最新章；重算刷新第 N 章快照，不改正文、章节索引与 workflow-start；重开已把状态回退到 N-1，重算基线仍是 `snapshots/<N-1>`；已结算章不要调 `story_settle_chapter`。',
].join('\n')

const CHAPTER_REPAIR_EN = [
  '## Resettle (recompute)',
  'When the author asks to "resettle / sync state" after a revision, a prose restore, or a reopen rollback:',
  "1. Review again as needed (revision, restoring prose, or reopening writes or replaces this chapter's workflow start; the review consumes it; resettling without a review blocks the next chapter's start).",
  '2. Before dispatching the settler, paste the raw baseline of chapter N-1 (`source/story/snapshots/<N-1>/state/`: the four JSON files and the three snapshot projections) into the settler prompt and declare it the only baseline; the current projection in `source/story/state/` is reference only.',
  '3. Call `story_resettle_chapter` (without validation) with the delta to generate a resettle proposal; dispatch a state-check subagent to reconcile the proposal, the published prose, `story_frame` and `book_rules`, returning only {reconciliationRequired, reportMarkdown} under the same criteria as settlement; do not call `story_state_check` before settling.',
  "4. When consistent, submit with validation; when recompute is needed, the tool records the report and rejects; hand the proposal file's failureReport to the settler to redo once, then propose and reconcile again; a second failure or an unavailable validator rejects without writing any work file.",
  '5. Only the latest chapter is supported; resettling refreshes the chapter N snapshot and does not change the prose, the chapter index, or workflow-start; reopening already rolled the state back to N-1 and the baseline is still `snapshots/<N-1>`; do not call `story_settle_chapter` for a settled chapter.',
].join('\n')

/** 阶段协议：基础协议 + 已开过章时的重算入口。 */
export function renderStageProtocol(facts: StageFacts): string {
  const base = renderStageBase(facts)
  const hasChapterWork = facts.stage !== 'proposal' && facts.stage !== 'foundation'
    && (facts.currentChapter >= 1 || facts.hasChapters)
  if (!hasChapterWork) return base
  return `${base}\n${facts.language === 'en' ? CHAPTER_REPAIR_EN : CHAPTER_REPAIR_ZH}`
}

/** 本阶段主动加载的创作技能。 */
export function craftSkillsFor(stage: Stage): string[] {
  if (stage === 'proposal') return ['story-proposal']
  if (stage === 'review' || stage === 'chapter-done') return ['longform-writing', 'story-review']
  return ['longform-writing']
}

/** 读取技能正文与 references；缺失时返回空串而不是抛错。 */
export function renderCraft(packageRoot: string, stage: Stage, language: WorkLanguage = 'zh'): string {
  const parts: string[] = []
  for (const skill of craftSkillsFor(stage)) {
    const dir = join(packageRoot, 'skills', skill)
    try {
      parts.push(language === 'en' ? `# Craft guidance (${skill})` : `# 创作方法（${skill}）`, '', readFileSync(join(dir, 'SKILL.md'), 'utf8').trim())
    } catch {
      continue
    }
    const references = join(dir, 'references')
    if (existsSync(references)) {
      for (const file of readdirSync(references).filter((name) => name.endsWith('.md')).sort()) {
        const label = language === 'en' ? `## Reference: ${file.replace(/\.md$/u, '')}` : `## 参考：${file.replace(/\.md$/u, '')}`
        parts.push('', label, '', readFileSync(join(references, file), 'utf8').trim())
      }
    }
  }
  return parts.join('\n')
}

const WRITER_STOP_ZH = '## 草稿已落盘\n正文已写入草稿。现在停止：只回四行摘要（`标题：`、`字数：`、`草稿：`、`注意：`），不要调用其它工具，不要审稿、修订或结算。'
const WRITER_STOP_EN = '## Draft persisted\nThe prose is already in the draft. Stop now: return only four lines (`Title:`, `Words:`, `Draft:`, `Notes:`); do not call other tools, review, revise or settle.'

function writerDraftDone(agent: { session: unknown } | undefined): boolean {
  if (agent === undefined) return false
  try {
    const session = agent.session as {
      header?: { origin?: string, delegationDepth?: number }
      origin?: string
      delegationDepth?: number
      snapshotEvents?: () => ReadonlyArray<{ type?: string, data?: { name?: string } }>
    }
    const header = session.header ?? session
    const subagent = header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0
    if (!subagent) return false
    const events = session.snapshotEvents?.() ?? []
    return events.some((event) => event.type === 'tool/call' && event.data?.name === 'story_write_chapter')
  } catch {
    return false
  }
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
      if ((facts.stage === 'review' || facts.stage === 'chapter-done') && writerDraftDone(assembly.agent as { session: unknown } | undefined)) {
        return facts.language === 'en' ? WRITER_STOP_EN : WRITER_STOP_ZH
      }
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
      if (facts === undefined) return ''
      if ((facts.stage === 'review' || facts.stage === 'chapter-done') && writerDraftDone(assembly.agent as { session: unknown } | undefined)) return ''
      return renderCraft(packageRoot, facts.stage, facts.language ?? 'zh')
    },
  })
  return (): void => {
    disposeCraft()
    disposeStage()
  }
}
