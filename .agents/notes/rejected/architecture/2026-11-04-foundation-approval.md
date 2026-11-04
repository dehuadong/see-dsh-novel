# Agent Note: foundation.approval —— 作者确认闸门与回执

Status: rejected — 出树插件没有自定义 RPC，自造会话事件会破坏日志；由 [foundation-approval-gate](../../proposed/architecture/2026-11-04-foundation-approval-gate.md) 接管

## Problem

前三行能力已经能把大纲、规则、角色卡写进作品，但**写进去就等于定了**：没有任何一步停下来问作者「这版你认不认」。参考资料里这件事的形态是「提议与执行分离」——工具只提议，只有用户在 UI 上确认过的动作才带来执行权（`agent-session.ts` 的 `requestedIntent` 注释：Explicit user-confirmed action requested by the UI/command surface）。我们还没有这套分离，「确认」既没有入口也没有留痕。

## Proposal

### 闸门位置

闸门放在**阶段推进**，不放在每次写入：

- 写入（outline / details / cast_documents）照常落盘，可反复重写
- 推进到下一阶段、或把当前版本标记为定稿，必须先有一条确认回执

理由：四段里每一段都会重写，逐段确认会让作者点六次以上；而作者真正关心的是「这套基础设定能不能定」。

### 回执形态

确认产生一条 Session 事件 `story/approval`：

```
{ stage: 'foundation', decision: 'approve' | 'reject', note?: string, at: <ISO>, sessionId }
```

`schemaVersion`、被确认的工件清单（本次写入的 `relativePath` 集合）一并记入。回执只在 Session 里，不写进作品目录——作品是作者的，确认是操作痕迹。

### 谁产生回执

面板「作品」视图加一个确认区：显示当前阶段、待确认的工件清单、两个按钮（认可 / 退回）与一个可选备注框。点击后通过 Client 的 RPC 提交，由 Host 侧校验后追加事件。

工具侧只读回执：`story_gate` 查询当前阶段是否有有效回执，没有就拒绝推进并返回「缺确认」而不是静默通过。

### 面板按会话与工作区解析

视图的注册仍是全局的，但内容不再是写死的骨架：

- 从当前会话取工作目录，判断该目录是否是一部作品（存在 `source/story/`）
- 是作品且会话预设有 `see-dsh-novel` 能力 → 显示阶段、待确认工件、认可/退回
- 是作品目录但会话不是该预设 → 只读展示，不提供推进与确认动作
- 不是作品目录 → 显示「当前工作区不是作品」，并说明如何创建

### 非目标

- 逐章节的评审/修订确认（属于 `chapter.review`）
- 多作者或多人审批
- 回执的跨设备同步

## Alternatives considered

**每次工具调用都要求确认。** 最严格。否掉：四段要确认四次以上，作者会习惯性连点，确认退化成橡皮图章。

**在对话里用 `ask_user_question` 确认。** 零新 UI。否掉：对话里的确认不留可查询的回执，`story_gate` 无法机械判断「这一版被批准过」。

**把确认写进作品目录（如 `source/story/approvals.json`）。** 便于导出携带。否掉：作品目录是作者的文档，确认是操作痕迹；写进去会让「文档即作品」这条已定决策变脏。

**只在 UI 里置灰按钮，不做 Host 校验。** 省一层。否掉：绕过 UI 直接调工具就能推进，闸门形同虚设。

## Acceptance criteria

- 面板按会话解析：非作品目录显示未绑定；作品目录在非该预设会话中只读，不提供确认动作。
- 无回执时推进被拒绝，返回明确原因，且不产生任何文件写入。
- 面板显示当前阶段与待确认工件清单；认可后 Session 出现 `story/approval` 事件，含 stage、decision、工件清单、时间与 sessionId。
- `reject` 同样记事件，但不解锁推进。
- 回执只对「本次工件清单」有效：写入变更后旧回执不再放行。
- 消费者测试覆盖：缺回执拒绝、approve 放行、reject 不放行、工件变更使回执失效。
- 真实运行：同一预设会话里先被拒一次，确认后再放行，回执写入 `artifacts/real-runs/foundation.approval.json`。

## Risks

- 工件清单用路径集合比对，重命名或移动文件会让旧回执失效；这是有意保守，但作者可能困惑。
- 面板确认区是本项目第一处写操作 UI，交互细节（等待态、失败重试）没有参考实现可抄。
- 回执存在 Session 里，换会话后不可见；若作者跨会话继续同一作品，需要新的确认。
