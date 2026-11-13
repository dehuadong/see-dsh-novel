/**
 * 阶段上下文：按工作区状态判定阶段，主动注入阶段协议与创作技能。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { AgentPresetsLike, Disposer, PluginContext } from '../../../core/types.js'
import { chapterPlanPath } from '../../../core/chapter-plan.js'
import { renderArchitectContract } from './architect.js'
import { renderWriterContract } from './writer.js'
import { renderNumberedSources, renderReviewContract } from './review.js'
import { renderPlannerContract } from './planner.js'
import { chapterReviewPath } from '../../../core/chapter-review.js'
import { workflowStartedSync } from '../../../core/workflow-start.js'
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
}

/** 同步判定阶段：`systemPrompt.context` 的文本提供函数是同步的。 */
export function detectStage(root: string): StageFacts {
  if (!existsSync(join(root, 'work.json'))) return { stage: 'proposal', title: '', currentChapter: 0 }
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
  if (!FOUNDATION_FILES.every((file) => existsSync(join(root, file)))) {
    return { stage: 'foundation', title, currentChapter }
  }
  const nextChapter = currentChapter + 1
  const review = chapterReviewPath(nextChapter)
  if (existsSync(join(root, review))) return { stage: 'chapter-done', title, currentChapter }
  if (!workflowStartedSync(root, nextChapter)) return { stage: 'foundation-ready', title, currentChapter }
  const nextPlan = chapterPlanPath(nextChapter)
  if (!existsSync(join(root, nextPlan))) return { stage: 'plan', title, currentChapter }
  const prefix = `${String(nextChapter).padStart(4, '0')}_`
  const chaptersDir = join(root, 'source/chapters')
  const hasChapter = existsSync(chaptersDir) && readdirSync(chaptersDir).some((file) => file.startsWith(prefix) && file.endsWith('.md'))
  if (!hasChapter) return { stage: 'write', title, currentChapter }
  return { stage: 'review', title, currentChapter }
}

/** 阶段协议：只写做什么、按什么顺序调什么、产出什么。 */
export function renderStageProtocol(facts: StageFacts): string {
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
    case 'review':
      return [
        header,
        `目标：审第 ${next} 章的首版正文。`,
        '1. 读章节文档与章纲；按注入的写作方法审稿。',
        '2. 每条观察给出 code、summary、assessment（issue／resolved／observation／unavailable）与 sourceRefs。',
        '3. 引文只能引用注入的编号来源（sourceId 加行号或逐字 quote）；没有证据的条目不提交。',
        `4. 调 \`story_review_chapter\` 落盘第 ${next} 章的审稿记录。`,
        '5. 审稿不通过转修订时：spot-fix 按下方编号来源选范围并交 `ranges`／`replacements`（空串删段，非空按换行分行），其它模式交整段 content，可选用唯一 targetText。',
        '同一章只审一次；修订后必须重新审稿。',
        '审稿落盘后即停；不自动修订、结算或开下一章。',
        common,
      ].join('\n')
    case 'write':
      return [
        header,
        `目标：写第 ${next} 章的首版正文。`,
        '1. 调 `story_context_candidates`（purpose=writer）。',
        '2. 对 tasks 里的每个任务用原生 `subagent` 派发 composer；mode=complete 时跳过。拿回 {memory, role, state, storyFrame, volumeMap} 的 id 集合。',
        '3. 调 `story_context_package`（purpose=writer，selection=上一步的 id 集合）。若返回 compressionTask：对每个 chunk 派 subagent 压缩，合并后超预算重压一次；把最终文本作为 compressedText 重调 package；package 与 trace 会落盘。',
        `4. 读 \`source/story/runtime/chapter-${String(next).padStart(4, '0')}.intent.md\`、plan 与 context 作为章纲与上下文，派 writer 写正文。`,
        '5. 调 `story_write_chapter`（chapter、title、content）落盘；字数偏差只报告，不据此拒稿。',
        '不覆盖已存在的章节首版；修订走后续能力。',
        '正文落盘后即停，不自动审稿或进入下一章。',
        common,
      ].join('\n')
    case 'chapter-done':
      return [
        header,
        `目标：第 ${next} 章审稿已落盘，本章 workflow 结束；不要自动结算或开下一章。`,
        '1. 如果作者只是问候/讨论，正常回答，不改作品。',
        '2. 作者要求结算本章时：派 settler 子代理按正文与审稿记录产出 postSettlement／factOps／hookOps／newHookCandidates 与七字段摘要，再调 `story_settle_chapter`；结算会推进状态章号，写完即停。',
        '3. 作者要修订本章时：先问清要改哪里与模式（polish／rewrite／rework／anti-detect／spot-fix）。spot-fix 按下方编号正文选范围，派 reviser 子代理产出每段替换文本（空串删段，非空按换行分行），调 `story_revise_chapter`（ranges／replacements 与整段 content）；其它模式交整段 content，可选用唯一 targetText。修订会作废旧审稿，必须重新审稿后才能再停。',
        '4. 作者要求定稿时：调 `story_finalize_chapter` 写快照、章节索引并把作品推进到 active；定稿后本章闭环。',
        '5. 作者要重开或恢复旧版本时：先调 `story_chapter_versions` 列归档；恢复旧版用 `story_reopen_chapter` 带 versionId，任意章可用、只换正文并清运行时、不动状态；重开回退不带 versionId，仅限最后已结算章；重开后回到章前规划。',
        '6. 作者要删掉最新章时：调 `story_delete_chapter`；原文进 `chapters/.trash/`，状态回滚到上一章。',
        '7. 作者要求核对状态时：派 state-check 子代理读本章正文、当前状态与投影、上一章快照与权威文档，提交 `reconciliationRequired` 与证据报告，再调 `story_state_check`；只有换一份真值投影（truth projection）能消解不一致时才把 `reconciliationRequired` 置 true，正文或权威之间的矛盾只作观察、不授权重结算；findings 只回作者，不自动重结算。',
        '8. 下一章是后续能力/作者动作；不要自行开始。',
        common,
      ].join('\n')
  }
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
      const contract = facts.stage === 'foundation'
        ? renderArchitectContract(root)
        : facts.stage === 'write'
          ? renderWriterContract(root)
          : facts.stage === 'review'
            ? renderReviewContract(root)
            : facts.stage === 'chapter-done'
              ? renderNumberedSources(root, facts.currentChapter + 1)
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
