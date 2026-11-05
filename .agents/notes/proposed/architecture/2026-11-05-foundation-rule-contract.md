# Agent Note: foundation.rule-contract —— book_rules 的版本与严格读取

Status: proposed

## Problem

复刻侧现在只写 `book_rules.json`，不读、也不校验：`pipelines/long/tools.ts:184-186` 把模型给的 `bookRulesData` 原样 `JSON.stringify` 落盘，字段形状只靠 `contract.ts:74-92` 的工具 schema 兜（`additionalProperties: false`）。这有两个后果：

- 写出的文件没有 `version`，而源工程的 `BookRulesSchema` 是 `z.object({ version: z.literal("2"), … }).strict()`（`models/book-rules.ts:14-24`），读取端用它解析；源工程在写之前还会显式补版本并校验（`agents/architect.ts:306`、`harness/tools/longform-edits.ts:112`）。复刻写出的文件按源工程契约是不合法的；
- 没有任何读取入口。源工程的 `readBookRules` 同时读 `book_rules.md` 与 `book_rules.json`，严格解析后返回 `{ rules, body }`（`agents/rules-reader.ts:11-19`）。源工程里规划与上下文读 `.md`（`pipeline/runner.ts:965,1388,1516`），结构化 JSON 由写作角色读（`agents/writer.ts:108,223`，属于 P3）。复刻到 P3 才需要读 JSON，但写出的文件现在就已经不合契约。

本行补的是「写出的文件合法、读取入口存在」；`.md` 的消费仍留给 P2，JSON 的消费留给 P3。

## Proposal

### 一个严格契约模块

新增 `packages/see-dsh-novel/src/pipelines/long/book-rules.ts`：

```ts
export interface BookRules {
  version: '2'
  protagonist?: { name: string, personalityLock: string[], behavioralConstraints: string[] }
  genreLock?: { primary: string, forbidden: string[] }
  narrativePerson?: string
  prohibitions: string[]
  enableFullCastTracking: boolean
  fanficMode?: string
  allowedDeviations: string[]
}
export type BookRulesInput = Omit<BookRules, 'version'>
export function parseBookRules(value: unknown, file?: string): BookRules
export function withVersion(input: BookRulesInput): BookRules   // 注入 version: '2'
export async function readBookRules(root: string): Promise<{ rules: BookRules, body: string }>
export function bookRulesDataSchema(): JsonSchema
```

校验规则**逐条对齐源 schema**（`models/book-rules.ts:3-24`）：

| 字段 | 源工程 | 复刻 |
| --- | --- | --- |
| `version` | 字面量 `"2"` | 必须是字符串 `"2"` |
| `protagonist` | 可选、严格对象；`name` 是裸 `z.string()`（空串合法），两个数组裸 `z.array(z.string())` | 同左；不做 trim、不做非空 |
| `genreLock` | 可选、严格对象；`primary` 裸字符串，`forbidden` 裸数组 | 同左 |
| `narrativePerson` | 可选；`z.string().trim().min(1)`——写入时去掉首尾空白，空白即拒绝 | 同左（trim 后存，空白拒绝） |
| `fanficMode` | 同上 | 同上 |
| `prohibitions` | `z.array(z.string())`，空串与空数组合法 | 同左 |
| `enableFullCastTracking` | `z.boolean()` | 必须是布尔 |
| `allowedDeviations` | `z.array(z.string())` | 同左 |
| 未知字段 | `.strict()` 拒绝 | 拒绝，报错点名字段 |

报错带文件与字段路径（`book_rules.json: 字段 version 必须是 "2"`）。

`withVersion`：写路径用，把模型给的输入补成合法对象再校验——与源工程「模型不提供版本、宿主补」一致（`architect.ts:306`）。

`readBookRules`：读 `source/story/book_rules.md` 与 `source/story/book_rules.json`；JSON 解析失败或字段非法直接抛错，`.md` 去首尾空白后作为 `body` 返回；任一文件缺失时报错点名路径，不静默降级成空规则。

### 同一形状只有一处声明

`contract.ts` 的 `BookRulesData` 改为 `type BookRulesData = BookRulesInput`（不再手写第二份字段表）；工具 schema 的 `BOOK_RULES_DATA` 由 `bookRulesDataSchema()` 按同一份字段描述生成。测试断言：schema 的字段集合与校验器接受／拒绝的字段集合一致，未知字段两边都拒。

### 写路径改成「先补版本、再校验、后提交」

`pipelines/long/tools.ts` 的 details 写入前调 `withVersion` + `parseBookRules`；校验失败就不进入 `commitFoundation`，不会留下半份基础设定。落盘内容固定以 `version: "2"` 开头。

`test/foundation.test.mjs:51-62` 现在 `deepEqual` 整个 `book_rules.json` 且不传 version，本行同批把它改成「包含 version」的期望——它是 `foundation.architect` 的消费者，改契约必须同批改。

### 旧文件不迁移

此前真实运行写出的 `book_rules.json` 没有 `version`。源工程对 v1 文档有一次性的 `migrateLegacyBookDocuments`（`harness/legacy-book-migration.ts:10-68`），但它服务的是「导入既有作品库」；本项目的 v1 非目标写明「不导入既有作品库，不做历史数据清洗」（`docs/scope.md:58`），且从未发布过 v1 作品。因此复刻不实现迁移：`readBookRules` 对无 `version` 的文件直接报错；`.artifacts/` 下的演示工作区用重跑 details 或手改 `version` 处理。

## Alternatives considered

**读的时候容忍缺失的 `version`，按 2 处理。** 少一处迁移。否掉：源工程严格拒绝，容忍会让同一份文件在两边得到不同结果；宽松读取会把「写错了」藏到很久以后。

**照抄源工程的一次性迁移。** 更忠实。否掉：迁移的入口是「导入旧作品库」，本项目 v1 明确不做旧作品迁移（`docs/scope.md:58`），也没有 v1 用户；等真的需要导入旧库时，迁移应和导入能力一起做。

**只在读取端校验，写路径照旧。** 少改一处。否掉：源工程是写前校验（`architect.ts:306`）；写坏的文件只有到下一次读取才炸。

**把契约放进 `core/`。** 复用面更大。否掉：`book_rules` 是长篇管线的产物与输入，短篇／剧本会有自己的规则文件。

**用 zod 之类的运行时库。** 表达力强。否掉：仓库没有该依赖，工具 schema 已是手写子集；字段不到十个，手写校验更可控，报错能带中文路径。

## Acceptance criteria

- `story_foundation_details` 落盘的 `book_rules.json` 第一项是 `"version": "2"`，其余字段与入参一致；`readBookRules` 读回同一对象，`body` 是 `.md` 去首尾空白的内容。
- 入参缺 `prohibitions`／`enableFullCastTracking`／`allowedDeviations`，或出现未知字段，或 `version` 不是 `"2"` → 校验失败、报错点名字段、**不写任何文件**。
- 与源 schema 一致：`prohibitions: [""]`、`protagonist.name: ""` 合法；`narrativePerson: "  "` 被拒绝；`narrativePerson: " 第一人称 "` 读回为 `"第一人称"`。
- `readBookRules` 在 `.json` 语法错或字段非法时抛错并点名文件与字段；缺 `book_rules.md` 或 `book_rules.json` 时抛错点名缺失路径；无 `version` 时报「version 必须是 \"2\"」，不自动补。
- 字段表只有一处：`BOOK_RULES_DATA` schema 的字段集合与 `parseBookRules` 的接受集合一致（测试遍历两边比对），未知字段两边都拒。
- `test/foundation.test.mjs` 的 `book_rules.json` 期望同批改为含 `version`。
- 实现与证据：implementation `packages/see-dsh-novel/src/pipelines/long/book-rules.ts`；consumer `packages/see-dsh-novel/test/book-rules.test.mjs`；写路径与 schema 改动在 `src/pipelines/long/tools.ts`、`src/pipelines/long/contract.ts`、`test/foundation.test.mjs`；realRun `artifacts/real-runs/foundation.rule-contract.json`。
- 真实运行：在一个空工作区的会话里调 `story_foundation_details` 写一份基础设定，确认 `book_rules.json` 带 `version:"2"`；再用 `readBookRules` 读回同一对象；另造一份无 `version` 的文件确认读取报错。回执记录该会话 id 与两条命令输出。

## Risks

- 旧演示工作区与历史回执里的 `book_rules.json` 没有版本，读取会失败；这是源工程行为，不是缺陷。
- 手写校验覆盖了源 schema 的字段与类型，但没有覆盖 zod 的全部语义（如 `z.string()` 不 trim、`.trim().min(1)` 的转换）；上表逐条列出，实现按表来。
- `fanficMode`／`narrativePerson` 是自由字符串，没有枚举。
- `.md` 只做去空白；源工程也不把散文重新解释成结构。
- 账本 `source` 字段只能放一个路径：本行取 `models/book-rules.ts`（契约本体），读取行为的源位置 `agents/rules-reader.ts` 记在本文；`dsh` 字段补 `library`，因为读取入口不是工具，是给 P3 用的库函数。
