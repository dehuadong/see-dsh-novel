# Agent Note: foundation.control-docs —— brief 与两份方向文档的播种与读取

Status: proposed

## Problem

源工程有三份控制文档，复刻侧一份都没有：

- `source/brief.md`：`create_work` 把立意原文写在这里（`harness/tools/work-creation.ts:27`），同时存进 `metadata.intent`；作者最初的意图，写作与评审要读。`story/brief.md` 是另一条流水线的外部上下文槽，属于 P2，不在本行。
- `story/author_intent.md`（长期方向）与 `story/current_focus.md`（短期焦点）：属于 truth 的 direction 类（`interaction/truth-authority.ts:30-32`）。`ensureControlDocuments` 在缺失时写入语言相关的默认模板；给了 `authorIntent` 就用它（`trimEnd() + "\n"`），否则用默认（`state/manager.ts:76-104`）。第一次真值写入前会先 `ensureControlDocuments`（`harness/tools/longform-edits.ts:105`），`loadControlDocuments` 读取前也会先补（`state/manager.ts:112`）。`authorIntent` 只在长篇初始化时由 runner 选项传入（`runner.ts:498-502`）；本行的立项走 `create_work`，不传它。写作时它们作为**优先于模型默认**的用户方向块注入（`agents/writer.ts:463-476`），上下文装配按 `readOrEmpty` 读取（`forecast/context-builder.ts:49-50`）。

复刻的 `story_work_create` 没有 `intent`，不写 `brief.md`；两份方向文档也没有任何播种入口，`readWork` 的 `metadata` 不认 `intent`。结果是立项后没有任何「作者意图」落盘，P2 的上下文装配到时读到空。

## Proposal

### 立项：intent 原文、brief、意图与默认方向

`story_work_create` 增加顶层必填 `intent`，与源工程 `create_work` 的参数位置一致（`harness/tools/work-creation.ts:12`）：

- 校验：`typeof intent === 'string' && intent.length >= 1`（源工程 `minLength: 1`，空白串也算合法；不做 trim）；
- 写入 `source/brief.md`，内容与 `intent` 逐字一致；
- `work.json` 的 `metadata.intent` 保存原文（不 trim，与 `metadata` 里其它字段的规范化不同，需要单独的原样读取）；
- **不**在立项时播种方向文档：源工程 `create_work` 只写 brief 与作品身份（`work-creation.ts:27-36`），方向文档要等第一次真值写入或读取时才出现；
- 校验在任何写入之前：`intent` 不是字符串或为空串时整次失败，不留下半部作品。

### 播种

`core/control-docs.ts`：

```ts
export const BRIEF_FILE = 'source/brief.md'
export const AUTHOR_INTENT_FILE = 'source/story/author_intent.md'
export const CURRENT_FOCUS_FILE = 'source/story/current_focus.md'

export async function ensureControlDocuments(root: string, language: 'zh' | 'en', authorIntent?: string): Promise<FileWrite[]>
export async function readControlDocs(root: string): Promise<{ brief: string, authorIntent: string, currentFocus: string }>
```

`ensureControlDocuments` 只在文件缺失时生成写入项，由调用方并入同一次 `commitFoundation`；内容对齐源工程：

- `author_intent.md`：`authorIntent` 非空（去空白后）→ `authorIntent.trimEnd() + "\n"`；否则语言默认模板（中文 `# 作者意图\n\n（在这里描述这本书的长期创作方向。）\n`，英文 `# Author Intent\n\n(Describe the long-horizon vision for this book here.)\n`）；
- `current_focus.md`：语言默认模板（中文 `# 当前聚焦\n\n## 当前重点\n\n（描述接下来 1-3 章最需要优先推进的内容。）\n`）。

调用点与源工程一致：

- `story_foundation_details` 第一次写真值（book rules 与状态）时把默认文档并入同一次提交——源工程的 `write_truth_file` 写前也会 `ensureControlDocuments`（`longform-edits.ts:105`）；
- `readControlDocs` 先确保默认文档存在再读三份（与 `loadControlDocuments` 一致）；`brief` 缺失时返回空串；
- 立项（`create_work`）不播种方向文档。

### 写入口另立一行

三份控制文档的**替换写入**（源工程由 `write_truth_file` 承担）不在本行：本行只有播种与读取，写入会在没有任何作者输入的情况下伪造方向。写入口登记为新的保真债行 `foundation.direction-write`（`source: inkos:packages/core/src/harness/tools/longform-edits.ts`），记入 `docs/scope.md` 的 P1 债列表；它到时还要处理同一工具里其余 truth 文件的写入（outline、book rules 版本注入、状态投影重建、角色卡），那是另一行的范围，不在本行偷偷合并。

## Alternatives considered

**把 `intent` 做成可选。** 兼容旧调用。否掉：源工程 `minLength: 1`；可选会让「没有意图的作品」合法化，而源工程没有这种状态。

**方向文档不播种、等写工具出现再说。** 少写两段默认模板。否掉：源工程在第一次真值写入与每次读取时都补默认文档；不播种会让「文档不存在」与「文档为空」两种状态混在一起，P2 读到的也是空。

**本行顺手实现方向写入。** 少一行债。否掉：写工具要处理整份 truth 覆盖（含 `book_rules` 的版本注入与状态投影重建），塞进本行会绕开那些校验；写入口按能力拆行，每行带自己的校验。

**把 `metadata.intent` 也交给现有 `text()` 规范化。** 少一个原样读取。否掉：`text()` 会 trim，而源工程保存 `params.intent` 原文；意图首尾的空白属于作者原文，不该被身份层改写。

## Acceptance criteria

- `story_work_create` 缺 `intent`、或 `intent` 不是字符串时失败，且工作区不留任何新文件；`work.json` 不变。
- 立项成功后：`source/brief.md` 与 `intent` 逐字一致；`work.json` 的 `metadata.intent` 与 `intent` 逐字一致（含首尾空白）；立项本身不创建方向文档。
- `story_foundation_details` 之后：`source/story/author_intent.md` 与 `current_focus.md` 出现，内容是语言默认模板；已有文件不被覆盖。
- `readControlDocs`：三份都在时逐字返回；`author_intent.md` 被删后调用会先补默认模板再读；`brief.md` 被删时 `brief` 为 `""`，另外两份仍在。
- 语言取 `work.json` 的 `language`（缺省 `zh`）；英文作品得到英文默认模板。
- 立项参数形状：`intent` 在顶层，与 `title` 同级；`targetChapters` 等仍在 `metadata` 下。
- `WorkMetadata`／`METADATA_FIELDS`／`WORK_SCHEMA`／`workCreateParameters` 同批加 `intent`；`text()` 之外新增原样读取，避免 trim。
- `test/work.test.mjs` 的立项用例补 `intent`；新增 `test/control-docs.test.mjs`；`capabilities.yaml` 新增 `foundation.direction-write`（missing）并在 `docs/scope.md` P1 债列表登记。
- 实现与证据：implementation `packages/see-dsh-novel/src/core/control-docs.ts`；consumer `packages/see-dsh-novel/test/control-docs.test.mjs`；路径常量在 `src/core/story-paths.ts`；立项改动在 `src/core/work.ts` 与 `src/plugin/work-tools.ts`，details 播种改动在 `src/pipelines/long/tools.ts`；realRun `artifacts/real-runs/foundation.control-docs.json`。
- 真实运行：在新工作区用 `story_work_create`（带 `intent`）立项，确认 `source/brief.md` 与 `metadata.intent`；调一次 `story_foundation_details`，确认两份方向文档出现且内容是默认模板；删掉 `brief.md` 后 `readControlDocs` 打印 `brief` 为空、另两份仍在。

## Risks

- `intent` 必填会打断旧调用与旧回执的参数；本项目没有外部调用方，演示工作区重跑即可。
- `metadata.intent` 原样保存，与同一对象里被 trim 的标题类字段规则不同；读代码的人需要知道这一处例外。
- 默认模板的中文文案与源工程逐字对齐；改文案会让已有作品与新作品的默认内容不一致，重跑立项不会覆盖已有文件。
- 方向文档的写入口尚未实现，只能手改文件；这一债已登记为新行，不在本行假装完成。
