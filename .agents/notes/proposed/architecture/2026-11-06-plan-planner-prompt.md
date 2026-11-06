# Agent Note: plan.chapter —— planner 提示词注入与 plan 复用

Status: proposed

## Problem（D14／D15）

审计发现两处：

- **D14**：`plan.chapter` 没有 planner 的提示词。源工程 `agents/planner.ts` 用固定 system prompt（「把 governed context 编译为章节 memo，不写正文；方法来自已激活 Skill；保留用户方向与既成事实；只使用输入中存在的 hook id；提交一个具体目标与可读 Markdown 计划」）与固定 user message 分段（`# 第N章 memo 请求`／当前用户指令／权威上下文／上一章正文／宿主字数遥测）。复刻侧只有阶段协议的工具顺序。
- **D15**：源工程按持久进度取下一章，并**复用已落盘的 plan**（`loadPersistedPlan` 命中就直接返回，不重新生成）；复刻的 `story_plan_chapter` 遇到已存在 plan 直接拒绝。

## Proposal

### planner 契约：`src/pipelines/long/stages/planner.ts`

`renderPlannerContract(root)`（同步读盘）：

- 当前章 = `current_state.chapter + 1`；
- 方法段（中英两版，语义与源逐字对齐）：编译 governed context 为一份 memo，不写正文；方法来自随阶段提供的创作方法；保留用户方向与既成事实；只使用输入里存在的 hook id；提交一个具体目标与完整可读的 Markdown 计划；
- 用户消息骨架：
  - `# 第N章 memo 请求`
  - `## 当前用户指令`：优先 `brief.md`，否则 `current_focus.md`，否则 `author_intent.md`（与源 taskGoal 的拼接顺序一致）；
  - `## 权威上下文`：由 `story_context_package` 返回后填入（契约里注明「把 package 的 selectedContext 放这里」）；
  - `## 上一章正文`：存在 `source/chapters/NNNN_*.md` 时取末尾 2000 字；
  - `## 宿主字数遥测`：`用户目标：<chapterWordCount> 字。这是创作约束，不是宿主质量判决。`
- 可用 hook id 列表（`hooks.json`）单独一块，供 `threadRefs` 只从中选择；
- 空段省略。

注入：`plan` 阶段的 `story:stage` = 阶段协议 + planner 契约；创作方法仍由 `story:craft` 注入 `longform-writing`。

### plan 复用

`story_plan_chapter` 改成与源一致的缓存语义：

- 该章已有 plan → 读回 `loadChapterPlan`，返回 `{chapter, planPath, intentPath, plannerInputs, reused: true}`，**不覆盖、不校验入参**；
- 没有 plan → 按现有校验写入，返回 `reused: false`；
- 输出 schema 增加 `reused: boolean`。

### 不做的

- 进度来源仍用 `current_state.chapter`（结算行负责推进）；源工程的 manifest 进度属 `artifact.identity`／结算能力；
- 重规划（覆盖）仍不支持；源工程也没有覆盖入口。

## Alternatives considered

**planner 提示只写进技能。** 否掉：它是提示词契约（方法句 + 用户消息结构），不是创作方法。

**保留「已存在即拒绝」。** 否掉：源工程是复用缓存；拒绝会让工具在重试与恢复场景下不可用。

**入参变化时覆盖 plan。** 否掉：源工程只在没有持久 plan 时生成；覆盖会与已写正文错位。

## Acceptance criteria

- `plan` 阶段 `story:stage` 含：方法句（「编译」「不写正文」「只使用输入里存在的 hook id」）、`# 第N章 memo 请求`、当前用户指令、上一章正文（存在时）、字数遥测、可用 hook id 列表。
- 无 brief／无上一章／无 hooks 时对应段省略；英文作品输出英文方法句与 `# Chapter N memo request`。
- `story_plan_chapter` 在 plan 已存在时返回 `reused: true` 与原有 plan 内容，不写文件；不存在时 `reused: false` 并落盘。
- 测试：`test/planner-contract.test.mjs`（方法句、用户消息段、hook 列表、英文、缺省省略）；`test/plan-tool` 或 `test/chapter-plan.test.mjs` 补复用语义；`test/stage-context.test.mjs` 补 plan 阶段。
- 真实运行：在不含 plan 的 plan 阶段工作区（`.artifacts/work-plan`）先让模型抄出契约，再连续调用两次 `story_plan_chapter`，第二次须返回 `reused: true` 且文件未变。
- 实现与证据：implementation `packages/see-dsh-novel/src/pipelines/long/stages/planner.ts`；consumer `packages/see-dsh-novel/test/planner-contract.test.mjs`；realRun `artifacts/real-runs/plan.chapter.json`（重录）。

## Risks

- planner 契约增加 plan 阶段上下文（约 2–4KB，含上一章结尾）；
- 复用语义让「提交新 memo」在已有 plan 时静默返回旧值，调用方需读 `reused` 字段；
- 上一章正文只取末尾 2000 字，与源完整读取仍有差距，记在 D14 的残余里。
