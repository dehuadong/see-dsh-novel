# Agent Note: 技能束与 persona 的复刻基线（第 1、2 层）

Status: implemented

## Problem

源工程的写作方法不是压在一个技能文件里，而是**四层叠加**：每轮的 harness system prompt（Profile／作品绑定／确认续跑／行为边界／skill 政策）、按需加载的技能束（`SKILL.md` 路由 + `references/*.md` 细节方法）、按角色拆的方法 prompt（planner／writer／settler／reviewer）、每轮上下文包（work context、进度、摘要、book rules、truth 投影）。

复刻侧此前只有最后一层的一半：`longform-writing` 是一个 55 行的纯 `SKILL.md`，没有 `references/`，`foundation-design`、`state-projection` 这些方法整份缺失；预设 persona 只有六行，没有源工程那套行为边界与 skill 政策。结果是「技能覆盖整条工作流」在源工程成立、在复刻里不成立——P2 起规划章节时，方法与约束都无处加载。

## Decision

技能束与 persona 按源工程结构复刻，内容独立命名、不标注来源。本笔记只覆盖四层里的**第 1、2 层**（harness prompt 的行为边界与技能束）；第 3 层（按角色拆的方法 prompt）与第 4 层（每轮上下文包）由 P2／P3 的能力行承载，不属本笔记的已落地范围。

- `skills/longform-writing/SKILL.md` 只留「场景与推进／人物与因果／伏笔生命周期／交稿前自检」的方法与**参考文件路由**（基础设定、读者契约与推进、场景对话与篇幅、状态投影各一份）；
- 新增四份参考文件：`references/foundation-design.md`、`reader-contract-and-progression.md`、`scene-dialogue-and-length-budget.md`、`state-projection.md`，方法正文按源工程复刻成中文；
- 预设 persona 补上源工程 harness prompt 的行为边界：最新用户消息优先、只有工具产生副作用、完成态只来自工具回执与落盘产物、确认动作不得用聊天文字代替、作者已确认的约束要完整继承、技能提供方法不授予执行权、缺必需输入只问一个关键问题；
- 打包校验的允许集合加 `skills/*/references/*.md`，`test/agent-tools.test.mjs` 断言四份参考文件存在且 `SKILL.md` 路由到它们。

按角色拆的方法 prompt（planner／writer／settler）与上下文包仍缺，随 P2／P3 的对应能力行落地。

## Alternatives considered

**把四份参考文件的内容并进一个 `SKILL.md`。** 少四个文件，加载一次就全看到。否掉：源工程按「何时需要」拆分，是为了一次只加载当前阶段的方法；合并会让每次加载都带上不需要的章节，也丢掉「路由」这一层意图。

**只补 persona，不动技能。** 改动最小。否掉：P2 规划章节要用的读者契约与推进方法就在参考文件里，persona 写不下也不该写。

**恢复源工程的技能 id（`inkos-*`）。** 便于逐条对照。否掉：仓库规则要求复用时按独立项目口径命名、不标注来源；id 保持独立，内容与结构对齐即可。

## Consequences

收益：技能恢复成「路由 + 参考文件」的结构，模型在基础设定、规划、写作、结算四个时点各自加载对应方法；persona 与源工程的 harness 行为边界对齐，确认、完成态与技能权限的规则不再只靠工具描述兜底。

落地：`packages/see-dsh-novel/skills/longform-writing/`（SKILL.md + 四份 references）、`packages/see-dsh-novel/cordis.patch.yml` 的 persona、`src/tools/packaging.ts` 的允许集合、`test/packaging.test.mjs` 与 `test/agent-tools.test.mjs`。

代价与已知限制：

- 参考文件是按源工程方法正文复刻的中文版本，不是逐字翻译；措辞会随中文表达调整，方法要点保持一致。
- 打包体积随参考文件增长（当前 tarball 11 个文件）；`check-package` 的允许集合已覆盖该结构。
- 按角色的方法 prompt 与上下文包尚未复刻，技能束只能覆盖「方法」，不能替代每轮的上下文装配。
