# Agent Note: foundation.rule-contract —— book_rules 的版本与严格读取

Status: implemented

## Problem

复刻侧曾只写 `book_rules.json`，不读、也不校验：写路径把模型给的 `bookRulesData` 原样落盘，字段形状只靠工具 schema 兜（`additionalProperties: false`）。这有两个后果：

- 写出的文件没有 `version`，而源工程的 `BookRulesSchema` 是 `z.object({ version: z.literal("2"), … }).strict()`（`models/book-rules.ts:14-24`），读取端用它解析；源工程在写之前会显式补版本并校验（`agents/architect.ts:306`、`harness/tools/longform-edits.ts:112`）。复刻写出的文件按源工程契约不合法；
- 没有读取入口。源工程的 `readBookRules` 同时读 `book_rules.md` 与 `book_rules.json`，严格解析后返回 `{ rules, body }`（`agents/rules-reader.ts:11-19`）。源工程里规划与上下文读 `.md`（`pipeline/runner.ts:965,1388,1516`），结构化 JSON 由写作角色读（`agents/writer.ts:108,223`，属于 P3）。

## Decision

`book_rules` 现在是带版本、可严格读写的契约。

### 一个严格契约模块

`packages/see-dsh-novel/src/pipelines/long/book-rules.ts` 导出 `BookRules`、`BookRulesInput`（`Omit<BookRules, 'version'>`）、`parseBookRules`、`withVersion`、`readBookRules`、`bookRulesDataSchema`、`bookRulesFieldNames`。字段语义逐条对齐源 schema：

| 字段 | 源工程 | 复刻 |
| --- | --- | --- |
| `version` | 字面量 `"2"` | 必须是字符串 `"2"` |
| `protagonist` | 可选、严格对象；`name` 是裸 `z.string()`（空串合法），两个数组裸 `z.array(z.string())` | 同左；不 trim、不要求非空 |
| `genreLock` | 可选、严格对象；`primary` 裸字符串，`forbidden` 裸数组 | 同左 |
| `narrativePerson` | `z.string().trim().min(1)`——去首尾空白，空白拒绝 | 同左 |
| `fanficMode` | 同上 | 同上 |
| `prohibitions` | `z.array(z.string())`，空串与空数组合法 | 同左 |
| `enableFullCastTracking` | `z.boolean()` | 必须是布尔 |
| `allowedDeviations` | `z.array(z.string())` | 同左 |
| 未知字段 | `.strict()` 拒绝 | 拒绝，报错点名字段 |

报错带文件与字段路径（`book_rules.json: 字段 version 必须是 "2"`）。`withVersion` 注入版本再校验；`readBookRules` 读两个文件，`.md` 去首尾空白作为 `body`，任一缺失或 JSON 非法都点名路径报错。

### 同一形状只有一处声明

`contract.ts` 的 `BookRulesData` 是 `BookRulesInput` 的别名；`BOOK_RULES_DATA` 由 `bookRulesDataSchema()` 按同一份字段表生成。测试断言 schema 的键与 `bookRulesFieldNames()` 一致、且不含 `version`。

### 写路径先补版本、再校验、后提交

`pipelines/long/tools.ts` 的 details 在 `commitFoundation` 之前调 `withVersion`；校验失败不进入提交，不会留下半份基础设定。落盘内容以 `version: "2"` 开头。`test/foundation.test.mjs` 的 `book_rules.json` 期望同批改为含 `version`。

### 旧文件不迁移

源工程对 v1 文档有一次性 `migrateLegacyBookDocuments`（`harness/legacy-book-migration.ts:10-68`），但它服务「导入既有作品库」；本项目 v1 非目标写明「不导入既有作品库，不做历史数据清洗」（`docs/scope.md:58`），也从未发布 v1 作品。`readBookRules` 对无 `version` 的文件直接报错；演示工作区用重跑 details 或手改 `version` 处理。

## Alternatives considered

**读的时候容忍缺失的 `version`，按 2 处理。** 少一处迁移。否掉：源工程严格拒绝，容忍会让同一份文件在两边得到不同结果，并把「写错了」藏到很久以后。

**照抄源工程的一次性迁移。** 更忠实。否掉：迁移入口是「导入旧作品库」，本项目 v1 明确不做旧作品迁移，也没有 v1 用户；真需要导入时，迁移应与导入能力一起做。

**只在读取端校验，写路径照旧。** 少改一处。否掉：源工程是写前校验；写坏的文件只有到下一次读取才炸。

**把契约放进 `core/`。** 复用面更大。否掉：`book_rules` 是长篇管线的产物与输入，短篇／剧本有自己的规则文件。

**用 zod 之类的运行时库。** 表达力强。否掉：仓库没有该依赖，工具 schema 已是手写子集；字段不到十个，手写校验更可控，报错能带中文路径。

## Consequences

收益：`book_rules.json` 从「只写不读」变成有契约的文件——写路径先补 `version: "2"` 再严格校验，读路径同时返回结构化规则与散文正文；字段语义逐条对齐源 schema，同一份字段表同时生成工具 schema 与校验器，两边不会再漂移。

落地：`packages/see-dsh-novel/src/pipelines/long/book-rules.ts`、`src/pipelines/long/contract.ts`（`BookRulesData` 别名与生成式 schema）、`src/pipelines/long/tools.ts`（写前补版本并校验）、`test/foundation.test.mjs`（期望含 `version`）。

验证见 `test/book-rules.test.mjs`：版本注入与字段顺序（`version` 必须在最前）、缺必填与未知字段拒绝、裸字符串／空数组合法、protagonist 内部必填与未知字段、读取往返与正文去空白、缺失 `.md`／缺失 `.json`／语法错／无版本四种失败、schema 字段集合与校验器字段表一致且不含 `version`、`narrativePerson` 的说明文案保留。`test/foundation.test.mjs` 另断言：非法 details 在写盘前被拒绝（目录里没有任何文件），以及落盘的 `book_rules.json` 含 `version`。

### 代价与已知限制

- 旧演示工作区与历史回执里的 `book_rules.json` 没有版本，读取会失败；这是源工程行为，不是缺陷。
- 手写校验覆盖字段与类型，但不覆盖 zod 的全部语义；以上表逐条对照为准。
- `fanficMode`／`narrativePerson` 是自由字符串，没有枚举。
- `.md` 只去首尾空白；源工程也不把散文重新解释成结构。
- 账本 `source` 只能放一个路径，本行取 `models/book-rules.ts`（契约本体）；读取行为的源位置 `agents/rules-reader.ts` 记在本文，`dsh` 字段含 `library`，因为读取入口不是工具，是给 P3 用的库函数。
