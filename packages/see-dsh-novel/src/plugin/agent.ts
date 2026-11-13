/**
 * Agent half: registers the story tools for every agent that selects the
 * `see-dsh-novel` preset. Mounted by the preset's `plugins` list, never by a
 * composition-root row — a root row would register the tools globally.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { countHooks, validateHooks } from '../core/hooks.js'
import type { HooksState } from '../core/hooks.js'
import type { Disposer, ExecuteContext, PluginContext, ToolDefinition } from '../core/types.js'
import { readWork, workProbes } from '../core/work.js'
import { installCastContext } from '../pipelines/long/cast.js'
import { installStageContext } from '../pipelines/long/stages/index.js'
import { installApprovalCommands } from '../pipelines/long/commands.js'
import { installGateTools } from '../pipelines/long/gate.js'
import { renderHooksProjection } from '../core/state-projections.js'
import { projectionLanguage } from '../pipelines/long/language.js'
import { installStorySkills, packageRootOf } from '../pipelines/long/skills.js'
import { installFoundationTools } from '../pipelines/long/tools.js'
import { STORY_NEXT_NAME, storyNext, storyNextOutput, storyNextParameters } from './story-next.js'
import type { StoryNext } from './story-next.js'
import { installRecoveryTool } from './recovery-tool.js'
import { installProposalTool } from './proposal-tool.js'
import { installTelemetryTool } from './telemetry-tool.js'
import { installInitCommand } from './work-command.js'
import { installIndexCommand } from './index-command.js'
import { installExportCommand } from './export-command.js'
import { installBackupCommand } from './backup-command.js'
import { PRESET_ID } from './preset.js'
import { installReviseTool } from '../pipelines/long/revise-tool.js'
import { installSettleTool } from '../pipelines/long/settle-tool.js'
import { installResettleTool } from '../pipelines/long/resettle-tool.js'
import { installStateCheckTool } from '../pipelines/long/state-check-tool.js'
import { installReopenTools } from '../pipelines/long/reopen-tool.js'
import { installDeleteTool } from '../pipelines/long/delete-tool.js'
import { installWriteCommand } from './write-command.js'
import { installDeleteCommand } from './delete-command.js'
import { installWorkTools } from './work-tools.js'

export const name = 'see-dsh-novel-agent'

/**
 * The tool, command, skill and prompt registries plus the Session directory the
 * story tools write into.
 */
export const inject = ['tools', 'workingDirectory', 'commands', 'skills', 'systemPrompt'] as const

/** 包根目录：随包技能从这里读，源码与打包产物的深度不同。 */
const PACKAGE_ROOT = packageRootOf(import.meta.url, 'see-dsh-novel')

interface HooksResult {
  counts: Record<string, number>
  projection: string
}

/** Read-only view of the seeded hooks, rendered as the author-facing table. */
async function readHooks(ctx: PluginContext, exec: ExecuteContext): Promise<HooksResult> {
  if (!exec?.agent) throw new Error('story_hooks 需要所属 agent 会话')
  const root = await ctx.workingDirectory.ensure(exec.agent)
  const raw = await readFile(join(root, 'source/story/state/hooks.json'), 'utf8')
  const state = validateHooks(JSON.parse(raw) as HooksState)
  return { counts: countHooks(state), projection: renderHooksProjection(state, await projectionLanguage(root)) }
}

/** Register the story tools and hand back one disposer. */
export function apply(ctx: PluginContext): Disposer {
  const disposeStoryNext = ctx.tools.register({
    name: STORY_NEXT_NAME,
    description:
      'Return the current work and which phase comes next: unbound, foundation, draft or ready. '
      + 'Reads the workspace (work.json plus the foundation artifacts) and reports what the files support.',
    parameters: storyNextParameters,
    output: {
      schema: storyNextOutput,
      // The runtime renders this array as the tool card's content and calls
      // `.some` on it, so it must be an array of content blocks — not the
      // result object, and not undefined.
      render: (_args: unknown, value: StoryNext) => [{
        type: 'text' as const,
        text: `阶段 ${value.phase}` + (
          value.work !== null
            ? ` · ${value.work}`
            : value.phase === 'unbound' ? '（未绑定作品）' : '（缺 work.json）'
        ),
      }],
    },
    async execute(_args: Record<string, never>, exec: ExecuteContext): Promise<StoryNext> {
      if (!exec?.agent) throw new Error('story_next 需要所属 agent 会话；无归属时无法判断工作区')
      const root = await ctx.workingDirectory.ensure(exec.agent)
      const probes = await workProbes(root)
      return storyNext({
        ...probes,
        title: probes.hasWork ? (await readWork(root))?.title ?? null : null,
      })
    },
  } as ToolDefinition<Record<string, never>, StoryNext>)

  const disposeHooks = ctx.tools.register({
    name: 'story_hooks',
    description: 'List the pending hooks as a readable table with per-status counts. Read-only.',
    parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          counts: { type: 'object' },
          projection: { type: 'string' },
        },
        required: ['counts', 'projection'],
      },
      render: (_args: unknown, value: HooksResult) => [{ type: 'text' as const, text: value.projection }],
    },
    execute: (args: Record<string, never>, exec: ExecuteContext): Promise<HooksResult> => readHooks(ctx, exec),
  } as ToolDefinition<Record<string, never>, HooksResult>)

  const disposeFoundation = installFoundationTools(ctx)
  const disposeGate = installGateTools(ctx)
  const disposeCommands = installApprovalCommands(ctx)
  const disposeInit = installInitCommand(ctx)
  const disposeIndex = installIndexCommand(ctx)
  const disposeExport = installExportCommand(ctx)
  const disposeBackup = installBackupCommand(ctx)
  const disposeRevise = installReviseTool(ctx)
  const disposeSettle = installSettleTool(ctx)
  const disposeResettle = installResettleTool(ctx)
  const disposeStateCheck = installStateCheckTool(ctx)
  const disposeReopen = installReopenTools(ctx)
  const disposeDelete = installDeleteTool(ctx)
  const disposeWrite = installWriteCommand(ctx)
  const disposeDeleteCommand = installDeleteCommand(ctx)
  const disposeWork = installWorkTools(ctx)
  const disposeTelemetry = installTelemetryTool(ctx)
  const disposeRecovery = installRecoveryTool(ctx)
  const disposeProposal = installProposalTool(ctx)
  const disposeCast = installCastContext(ctx, PRESET_ID)
  const disposeStages = installStageContext(ctx, PACKAGE_ROOT, PRESET_ID)
  const disposeSkills = installStorySkills(ctx, PACKAGE_ROOT)

  return (): void => {
    disposeSkills()
    disposeStages()
    disposeCast()
    disposeProposal()
    disposeRecovery()
    disposeTelemetry()
    disposeWork()
    disposeInit()
    disposeIndex()
    disposeExport()
    disposeBackup()
    disposeRevise()
    disposeResettle()
    disposeSettle()
    disposeStateCheck()
    disposeReopen()
    disposeDelete()
    disposeWrite()
    disposeDeleteCommand()
    disposeCommands()
    disposeGate()
    disposeFoundation()
    disposeHooks()
    disposeStoryNext()
  }
}
