# Agent Note: foundation.architect —— 架构契约注入与四段依赖

Status: implemented

## Problem（D6）

审计发现 `foundation.architect` 只复刻了四段 tool schema，没有移植源工程的 architect system prompt：源 `agents/architect.ts` 的 `buildFoundationProtocol` 生成「按专业方法生成基础设定」+ 外部指令块 + 作品元信息（平台／题材／目标章数／每章字数／标题），并按阶段喂入前一步产物。复刻侧 foundation 协议只列四个工具，没有元信息、外部指令与依赖说明。

## Decision

`packages/see-dsh-novel/src/pipelines/long/stages/architect.ts` 的 `renderArchitectContract(root)`：

- 同步读 `work.json`：平台、题材、目标章数、每章字数、标题；
- `source/story/brief.md` 存在时整份进入「外部指令」块，不存在时省略；
- 主句「按随阶段提供的创作方法和输入权威生成作品基础设定」，结尾「通过指定工具提交可读基础资产和少量结构化规则」；
- 英文作品输出英文版（`External Instructions`／`Work metadata`）。

`stages/index.ts`：`foundation` 阶段的 `story:stage` 文本 = 四步协议 + 架构契约；四步协议写明依赖：

1. outline 提交 storyFrame／volumeMap；
2. details 入参带 outline，提交 bookRules／bookRulesData／pendingHooks；
3. cast index 入参带 outline 与 bookRules，只提交姓名与级别；
4. cast documents 为索引里的每个人写一张卡（中文约 150–250 字／英文 80–120 词）；
5. `story_gate` 查看签核。

## Alternatives considered

**写成新技能。** 否掉：元信息与提交要求是阶段契约；方法仍由 `longform-writing` 注入。

**主编手拼元信息。** 否掉：这正是审计发现的缺口。

**依赖写进工具描述。** 否掉：依赖关系属于阶段协议。

## Consequences

收益：foundation 阶段每轮都能看到完整的架构契约与四步依赖；元信息来自作品身份，不依赖模型记忆。

验证见 `test/stage-context.test.mjs`：foundation 阶段含元信息与依赖、无 brief 时无外部指令块、英文作品含 `External Instructions` 与英文元信息。

代价与已知限制：

- 审核反馈块（revise 流程）与 import／series／fanfic 变体未覆盖，属后续能力；
- 契约文本增加 foundation 阶段上下文约 0.5–1KB。
