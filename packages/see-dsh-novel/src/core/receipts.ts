/**
 * 作者确认回执：一条成功动作的留痕。
 *
 * 三个来源产出的都是同一行标记：面板命令 `/story-approve` 的命令结果、
 * 签核工具在原生确认条里获批后的结果。读到标记后还要用当前工件摘要复核，
 * 旧标记不会因为格式没变就继续放行；退回命令是同样重要的一条决定，
 * 它会把更早的确认作废。
 */
import type { SessionEventLike } from './types.js'

/** 标记行的固定前缀，产出方与解析方共用同一个常量。 */
export const APPROVAL_MARKER = 'story-approval'

/** 标记行的固定形状；`files` 只给人读的凭据留档，不参与判定。 */
const MARKER_LINE = /^story-approval stage=(\S+) digest=([0-9a-f]{64}) files=(\d+) via=(receipt|approval)$/

/** 确认是作者在哪个入口给出的。 */
export type ApprovalChannel = 'receipt' | 'approval'

/** 最近一次作者决定；退回不带摘要，它只表示「这一版不算数」。 */
export type ApprovalDecision =
  | { kind: 'approve', time: number, digest: string, channel: ApprovalChannel }
  | { kind: 'reject', time: number }

/** 产生回执的三个动作名。 */
export interface DecisionSources {
  stage: string
  approveCommand: string
  rejectCommand: string
  signoffTool: string
}

/** 生成标记行；调用方负责把它放在人读文本的最后一行。 */
export function approvalMarkerLine(
  stage: string,
  digest: string,
  files: number,
  channel: ApprovalChannel,
): string {
  return `${APPROVAL_MARKER} stage=${stage} digest=${digest} files=${files} via=${channel}`
}

/**
 * 从一段结果文本里读出标记行。
 *
 * 取最后一处匹配：产出方把标记放在文本末尾，作者备注里即使出现同样的字样
 * 也不会覆盖真正的结论。
 * @param text 命令或工具返回的文本
 * @returns 标记内容；没有标记或格式不符时 undefined
 */
export function parseApprovalMarker(text: unknown): { stage: string, digest: string, channel: ApprovalChannel } | undefined {
  if (typeof text !== 'string') return undefined
  let found: { stage: string, digest: string, channel: ApprovalChannel } | undefined
  for (const line of text.split('\n')) {
    const matched = MARKER_LINE.exec(line.trim())
    if (matched === null) continue
    const [, stage, digest, , channel] = matched
    if (stage === undefined || digest === undefined) continue
    if (channel !== 'receipt' && channel !== 'approval') continue
    found = { stage, digest, channel }  }
  return found
}

/** 一条工具结果消息里的纯文本。 */
function messageText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const text = (block as Record<string, unknown>)['text']
    if (typeof text === 'string') parts.push(text)
  }
  return parts.join('\n')
}

/**
 * 按日志顺序找出最近一次作者决定。
 *
 * `command/done` 与 `tool/result` 都不带名字，所以先读 `command/run` 与
 * `tool/call` 建两张配对表。面板确认与原生确认读到的是同一种标记。
 * @param events 会话事件，按日志顺序
 * @param sources 目标阶段与三个产出动作的名字
 */
export function latestDecision(
  events: ReadonlyArray<SessionEventLike>,
  sources: DecisionSources,
): ApprovalDecision | undefined {
  const commandNames = new Map<string, string>()
  const toolNames = new Map<string, string>()
  let latest: ApprovalDecision | undefined

  for (const event of events) {
    const data = event.data as Record<string, unknown> | undefined
    if (data === undefined) continue
    if (event.type === 'command/run') {
      if (typeof data['commandId'] === 'string' && typeof data['name'] === 'string') {
        commandNames.set(data['commandId'], data['name'])
      }
      continue
    }
    if (event.type === 'tool/call') {
      if (typeof data['callId'] === 'string' && typeof data['name'] === 'string') {
        toolNames.set(data['callId'], data['name'])
      }
      continue
    }
    if (event.type === 'command/done') {
      if (data['kind'] !== 'success') continue
      const name = commandNames.get(String(data['commandId']))
      if (name === sources.rejectCommand) {
        latest = { kind: 'reject', time: event.time }
        continue
      }
      if (name !== sources.approveCommand) continue
      const marker = parseApprovalMarker(data['text'])
      if (marker === undefined || marker.stage !== sources.stage) continue
      latest = { kind: 'approve', time: event.time, digest: marker.digest, channel: marker.channel }
      continue
    }
    if (event.type === 'tool/result') {
      const message = data['message'] as Record<string, unknown> | undefined
      if (message === undefined) continue
      if (toolNames.get(String(message['toolCallId'])) !== sources.signoffTool) continue
      const marker = parseApprovalMarker(messageText(message['content']))
      if (marker === undefined || marker.stage !== sources.stage) continue
      latest = { kind: 'approve', time: event.time, digest: marker.digest, channel: marker.channel }
    }
  }
  return latest
}
