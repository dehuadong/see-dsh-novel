# Agent Note: panel.confirm 的作者附言（AU-11）

Status: implemented

## Problem

`panel.confirm` 的 AU-11 有三条：

1. `/story-write` 不接收作者附言，`workflow-start.instruction` 恒为默认「开始第 N 章」；作者方向没有生产链。
2. `write_next` 的 `chapterCount`（缺省 1，可 >1）未复刻；单条 start 只按章授权、审后即清，N>1 无法执行。
3. 回执只有 `process:panel.confirm` 的进程级证据，没有真实 DSH 会话。

本行只做 **作者附言**；chapterCount 与真实会话保留为 AU-11 残余。

## 源工程证据

- `longform-production.ts:200-209`：`write_chapters` 把 `params.instruction` 作为 `externalContext` 传给 `pipeline.writeChapters`，即作者附言进入写章调用。
- `interaction/session-transcript.ts:12-24`：`confirmedRequestInstruction` 从确认请求恢复作者输入，确认后的 instruction 不是固定句。
- 残余证据：`action-envelope.ts:46-48` 的 `chapterCount`、`server.ts:1213` 缺省 1、`longform-production.ts:203` 的 writeChapters count；本行不实现。
- 复刻：`write-command.ts:33-51`、`workflow-start.ts:18-24`、`panel.confirm.json`。

## Decision

### 范围与非目标

范围：

1. `/story-write` 命令注册加 `input: { hint }` 并改描述，使带参调用能到 handler。
2. 解析 `rawInput` 为作者附言：trim 后非空写入 `workflow-start.instruction`；空则用默认句。
3. handler 把附言传给 `startChapter`；成功文本显示已写入附言。
4. writer 契约已读 `workflow-start.instruction`，附言因此进入写作输入。
5. 测试：命令声明 input.hint、带附言写 start、空附言默认、面板无参不变、旧 start 兼容。

非目标：

- **不实现 chapterCount**：单 start 按章授权、审后清除，N>1 需要跨章 start/状态推进，属独立能力；保留 AU-11 债。
- 不做 `create_book` 确认（归 `proposal.creative`）。
- 不改面板按钮语义；仍确认一章、无附言。
- 不伪造真实 DSH 会话；process 回执 limitation 保留。

### 产品行为与验收

- 作者可用 `/story-write 写得更冷`，start.instruction 为该文本，writer 契约读到。
- `/story-write` 无参数仍为默认句；面板按钮不变。
- 非法/空输入不写坏 start。
- chapterCount 仍缺；AU-11 不关闭。

### 决定与未决问题

- **只做附言**：chapterCount 需要改多个阶段的跨章授权，不能半落盘；本行不碰。
- **命令声明 input.hint**：DSH 只有声明了 input 的命令才把带参调用交给 handler；不声明解析器是死代码。
- **消费者**：writer 读 instruction；planner 仍读 brief/author_intent，属 AU-22 残余。
- 未决问题：chapterCount 是否进入 v1，由后续工作项裁决。

### 评审与批准证据

- Plan Review 三轴：Standards／Spec／Architecture 均通过（多轮）。
- 作者授权：AU-11 单行。
- 作者批准实施：`/implement 批准，执行实现 panel.confirm 审计修复（AU-11）`。

## Design

### write-command.ts

- 注册项增 `input: { hint: '可选：写本章的方向；缺省用默认句' }`；description 改「可选附言」。
- `parseInstruction(rawInput)`：trim；空返回 undefined；不解析 `--chapters`。
- `startChapter(root, instruction?)` 已有第二参，直接传。
- handler 用 `parseInstruction(invocation.rawInput)`；成功文本含附言摘要。

### workflow-start.ts

- 不改 schema；instruction 已存在，默认句由 handler 填。
- 旧 start 读取不变。

### 测试

- `write-command.test`：命令声明 input.hint；`/story-write 写得更冷` 写入；空参默认；重复 start 拒绝。
- host 命令清单不变；client 面板命令不变。
- realRun 重录 process-level，保留真实会话 limitation。

### 同步

- `fidelity-audit.md`：`panel.confirm` 维持机制等价；AU-11 债在 scope（chapterCount/真实会话）。
- `scope.md`：AU-11 只留 chapterCount 与真实会话；附言划掉。
- `artifacts/implementation-audit/rows/panel.confirm.json`：更新证据/limitations。
- `capabilities.yaml`：consumer 指 write-command；realRun 重录。
- Note 转 implemented；`verify-notes`。

## Alternatives considered

- **同时做 chapterCount**：最贴源。否掉：单 start 按章授权，N>1 会放行不了后续章；半落盘仍是债。
- **数字位置参数**：`/story-write 3`。否掉：附言可能以数字开头；本行不做章数。
- **新增 approval decision**：更源。否掉：命令通道已登记，第二套 decision 重复。
- **把附言写进 brief 文件**：可选。否掉：源对应 externalContext/start，不是持久 brief。

## Consequences

- **附言被当命令参数**：只取原始文本，不解析 flag。
- **旧 start**：schema 不变，兼容。
- **真实会话**：process 回执不能冒充；AU-11 保留债。
- **面板无附言**：按钮仍一章；附言只在命令/API 路径。

## Verification

1. `/story-write 写得更冷` 后 start.instruction 是该文本；writer 契约能读到。
2. `/story-write` 无参数仍默认句；面板「开始下一章」不变。
3. 命令声明 `input.hint`，带参调用能进入 handler；空附言不写空串。
4. chapterCount 与真实 DSH 会话仍缺，AU-11 维持保真债；scope/fidelity/audit/realRun 同步；`pnpm run verify` 通过；CI 双端。

## 实施记录

- Plan Review 三轴：Standards／Spec／Architecture 均通过（多轮）。
- 实施：命令 input.hint、作者附言写入 workflow-start、空附言默认；chapterCount/真实会话留债。`pnpm run verify` 537 passed／1 skipped；realRun 重录；CI `43586024142` 的 `verify (ubuntu-latest)` 与 `verify (windows-latest)` 均通过（提交 `49d1173`）。
