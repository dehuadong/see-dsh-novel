# Agent Note: foundation.architect —— 架构契约注入与四段依赖

Status: proposed

## Problem（D6）

审计发现 `foundation.architect` 只复刻了四段 tool schema，没有移植源工程的 architect system prompt：

- 源 `agents/architect.ts` 的 `buildFoundationProtocol` 生成「按专业方法生成基础设定」+ 外部指令块 + 作品元信息（平台／题材／目标章数／每章字数／标题）；
- 生成是**分阶段**的：先提交 story_frame／volume_map；再把这两份喂给 details 提交 book rules 与 pending hooks；再用 story_frame／volume_map／bookRules 让 cast index 选人；最后为这些人写卡；
- 反馈块（上一轮审核意见）与语言前缀是契约的一部分。

复刻侧 foundation 阶段协议只写了「依次调四个工具」，没有元信息、外部指令、阶段依赖，也没有 cast 的方法说明；模型每轮看到的架构契约不完整。

## Proposal

### 架构契约：`src/pipelines/long/stages/architect.ts`

`renderArchitectContract(root)`（同步读盘）：

- 元信息：`平台`、`题材`、`目标章数`、`每章字数`、`标题`，来自 `work.json`；
- 外部指令：`source/story/brief.md` 存在时整份进入（对应源 `contextBlock`）；不存在时省略整块；
- 主句：「按随阶段提供的创作方法和输入权威生成作品基础设定」；
- 提交要求：「通过指定工具提交可读基础资产与少量结构化规则」；
- 英文作品输出英文版文本（对应源的语言前缀）。

### 阶段协议补依赖

`foundation` 阶段协议在四步之间写清依赖：

1. `story_foundation_outline`：提交 storyFrame／volumeMap；
2. `story_foundation_details`：入参带上 step 1 的 storyFrame／volumeMap，提交 bookRules、bookRulesData 与 pendingHooks；
3. `story_foundation_cast_index`：入参带上 storyFrame／volumeMap／bookRules，只提交姓名与主次级别；
4. `story_foundation_cast_documents`：为 step 3 的每个人提交一张卡（当下动机、已知信息、关系压力、能力边界，约 150–250 字中文／80–120 词英文）；
5. `story_gate` 查看签核。

### 注入位置

`installStageContext` 的 `story:stage` 在 `foundation` 阶段把契约拼在协议之后（同一 context 文本），不新增 context 条目；`story:craft` 仍注入 `longform-writing`（方法）。

### 不做的

- 审核反馈块（revise 流程）留给 foundation 修订能力；
- import／series／fanfic 的架构变体留给对应导入能力。

## Alternatives considered

**把 architect 契约写成新技能。** 否掉：它是阶段契约（元信息、提交要求），不是创作方法；方法仍由 `longform-writing` 注入。

**每次由主编手拼元信息。** 否掉：这正是审计发现的缺口；元信息必须由宿主从 work.json 读取。

**把四段依赖留在工具描述里。** 否掉：工具描述是单工具的，依赖关系属于阶段协议。

## Acceptance criteria

- `foundation` 阶段 `story:stage` 文本含：元信息五行（平台／题材／目标章数／每章字数／标题）、外部指令（brief 存在时）、四步依赖（details 带 outline、cast 带 rules、cards 带 cast index）。
- `brief.md` 不存在时不出现外部指令块；英文作品文本为英文。
- 非 preset 或非 foundation 阶段不出现该契约。
- 测试：`test/stage-context.test.mjs` 补 foundation 的元信息、brief 与依赖断言；英文与无 brief 分支。
- 真实运行：在 foundation 阶段工作区（`work-control`）发一句「列出你收到的基础设定契约：元信息、外部指令、四步依赖」，回答须逐项对上。
- 实现与证据：implementation `packages/see-dsh-novel/src/pipelines/long/stages/architect.ts`；consumer `packages/see-dsh-novel/test/stage-context.test.mjs`；realRun `artifacts/real-runs/foundation.architect.json`（重录）。

## Risks

- 契约文本增加 foundation 阶段上下文约 0.5–1KB；
- 元信息读盘失败（work.json 损坏）时契约退化为只含四步协议，需在测试里覆盖；
- 源工程的 review feedback 与 import 变体未覆盖，属后续能力。
