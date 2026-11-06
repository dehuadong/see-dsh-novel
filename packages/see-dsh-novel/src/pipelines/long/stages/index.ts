/**
 * 阶段上下文：按工作区状态判定阶段，主动注入阶段协议与创作技能。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { AgentPresetsLike, Disposer, PluginContext } from '../../../core/types.js'
import { chapterPlanPath } from '../../../core/chapter-plan.js'
import { chapterReviewPath } from '../../../core/chapter-review.js'
import {
  STORY_CHAPTER_SUMMARIES_MD,
  STORY_CURRENT_STATE_MD,
  STORY_FRAME_FILE,
  STORY_PENDING_HOOKS,
  STORY_RULES_MD,
  STORY_VOLUME_MAP_FILE,
} from '../../../core/story-paths.js'

export const STAGE_CONTEXT_NAME = 'story:stage'
export const STAGE_CONTEXT_ORDER = 90
export const CRAFT_CONTEXT_NAME = 'story:craft'
export const CRAFT_CONTEXT_ORDER = 95

export type Stage = 'proposal' | 'foundation' | 'plan' | 'write' | 'review'

/** 基础设定六件套；齐了才算进入规划。 */
const FOUNDATION_FILES = [
  STORY_FRAME_FILE,
  STORY_VOLUME_MAP_FILE,
  STORY_RULES_MD,
  STORY_CURRENT_STATE_MD,
  STORY_PENDING_HOOKS,
  STORY_CHAPTER_SUMMARIES_MD,
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
  const nextPlan = chapterPlanPath(nextChapter)
  if (!existsSync(join(root, nextPlan))) return { stage: 'plan', title, currentChapter }
  const prefix = `${String(nextChapter).padStart(4, '0')}_`
  const chaptersDir = join(root, 'source/chapters')
  const hasChapter = existsSync(chaptersDir) && readdirSync(chaptersDir).some((file) => file.startsWith(prefix) && file.endsWith('.md'))
  if (!hasChapter) return { stage: 'write', title, currentChapter }
  void chapterReviewPath(nextChapter)
  return { stage: 'review', title, currentChapter }
}

/** 阶段协议：只写做什么、按什么顺序调什么、产出什么。 */
export function renderStageProtocol(facts: StageFacts): string {
  const next = facts.currentChapter + 1
  const header = `## 当前阶段：${{ proposal: '提案', foundation: '基础设定', plan: '章前规划', write: '正文写作', review: '章后审阅' }[facts.stage]}`
  const common = '本阶段的创作方法已随上下文提供；不需要再调用技能工具加载。'
  switch (facts.stage) {
    case 'proposal':
      return [
        header,
        '目标：把作者的一句话创作意图收敛成一张可确认的立项卡。',
        '1. 只问缺的关键信息（标题、方向、题材、平台、语言、目标章数、单章字数），一次问一个。',
        '2. 信息够了就调 `story_propose`（title、summary、instruction 必填，instruction 自包含）。',
        '3. 允许：落盘并进入基础设定；退回：只问想改哪一处后重新提案；取消：等作者重新开口。',
        common,
      ].join('\n')
    case 'foundation':
      return [
        header,
        '目标：按四段把基础设定写全，再请作者签核。',
        '1. `story_foundation_outline`：故事框架与卷图。',
        '2. `story_foundation_details`：细节设定。',
        '3. `story_foundation_cast_index`：角色索引。',
        '4. `story_foundation_cast_documents`：逐张角色卡。',
        '5. `story_gate` 查看签核状态；作者确认后进入规划。',
        common,
      ].join('\n')
    case 'plan':
      return [
        header,
        `目标：规划第 ${next} 章。`,
        '1. 调 `story_context_candidates`（query 用本章任务目标）。',
        `2. 用原生 \`subagent\` 派发 composer，把返回的 instruction 与 candidates 交给它，拿回 {memory, role, state, outline} 的 id 集合。`,
        '3. 调 `story_context_package`（超预算时连同压缩文本一起传）；读 package 与 trace。',
        `4. 按 package 写 memo（goal / body / threadRefs），再调 \`story_plan_chapter\` 落盘第 ${next} 章。`,
        '只规划下一章；该章已有章纲时不覆盖。',
        common,
      ].join('\n')
    case 'review':
      return [
        header,
        `目标：审第 ${next} 章的首版正文。`,
        '1. 读章节文档与章纲；按注入的写作方法审稿。',
        '2. 每条观察给出 code、summary、assessment（issue／resolved／observation／unavailable）与 sourceRefs。',
        '3. 引文用原文行号范围或逐字 quote；没有证据的条目不提交。',
        `4. 调 \`story_review_chapter\` 落盘第 ${next} 章的审稿记录。`,
        '同一章只审一次；重审留给修订能力。',
        common,
      ].join('\n')
    case 'write':
      return [
        header,
        `目标：写第 ${next} 章的首版正文。`,
        `1. 读 \`source/story/runtime/chapter-${String(next).padStart(4, '0')}.intent.md\` 与 plan 作为章纲。`,
        '2. 用原生 `subagent` 派发 writer：带上章纲、上下文、book rules、风格指南、目标字数；子代理只返回正文。',
        '3. 调 `story_write_chapter`（chapter、title、content）落盘；字数偏差只报告，不据此拒稿。',
        '不覆盖已存在的章节首版；修订走后续能力。',
        common,
      ].join('\n')
  }
}

/** 本阶段主动加载的创作技能；空数组表示不注入。 */
export function craftSkillsFor(stage: Stage): string[] {
  return stage === 'proposal' ? ['story-proposal'] : stage === 'foundation' || stage === 'write' || stage === 'review' ? ['longform-writing'] : []
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
      return facts === undefined ? '' : renderStageProtocol(facts)
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
