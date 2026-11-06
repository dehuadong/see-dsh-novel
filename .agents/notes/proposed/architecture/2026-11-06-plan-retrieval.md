# Agent Note: plan.retrieval —— 章前检索的 FTS5 索引与 BM25 查询

Status: proposed

## Problem

章前规划要先按任务目标检索到伏笔、章节摘要、角色卡与素材，再交给上下文选择器。源工程的检索内核是 `retrieval/local-search.ts` 的 `LocalSearchIndex`：`node:sqlite` 的 `DatabaseSync`，`retrieval_documents` 表 + FTS5 表，`replaceScope` 增量重建，`search` 用 BM25 排序并按 scope/kind 过滤。复刻侧没有索引，也没有任何检索入口。

## Proposal

### 索引内核

`core/search-index.ts` 移植源实现的内核（不引入第三方依赖，Node 内置 `node:sqlite`）：

- `LocalSearchIndex(path)`：打开数据库、WAL、建 schema（`retrieval_documents` + FTS5 虚表 + 触发器或手工同步）；
- `replaceScope(scope, documents)`：按 `content_hash` 跳过未变文档，事务内 upsert + 删除消失的 id；
- `search(query, {scope, kinds?, limit?})`：`buildMatchQuery` 生成 FTS5 查询，`bm25()` 排序，limit 夹在 1..200，返回 `SearchHit[]`（含 `source`、`kind`、`title`、`body`、`score`）；
- `Document`：`{id, scope, kind, source, title, body, metadata?}`。

索引文件默认 `source/.index/retrieval.db`（作品根内、可删可重建），不进提交。

### 故事文档的索引

`core/story-index.ts`：`rebuildStoryIndex(root)` 把作品的可检索内容装进 scope = 作品 id：

| kind | 来源 | 一条文档 |
|---|---|---|
| `hook` | `state/hooks.json` | 每个伏笔一条，title 为 hookId + type，body 为 expectedPayoff/notes |
| `summary` | `state/chapter_summaries.json` | 每章一条 |
| `role` | `roles/**/*.md` | 每张卡一条，source 为卡路径 |
| `material` | `source/story/materials/**/*.md` | 每份素材一条 |
| `outline` | `outline/story_frame.md`／`volume_map.md` | 按标题分节 |

`rebuildStoryIndex` 每次调用都 `replaceScope`（内容哈希决定写入量），可重复执行；索引损坏或 schema 版本不符时删库重建。

### 消费者

新增只读工具 `story_search`：

- 参数：`query`（非空）、`kinds?`、`limit?`；
- 先 `rebuildStoryIndex(root)`，再 `search`；
- 返回 `hits: {source, kind, title, excerpt, score}[]`，`excerpt` 截到 200 字；
- 无命中返回空数组，不报错。

这是本行唯一的新入口；`plan.context-select` 之后直接复用同一索引与 `search`。

### 与 `search.unified` 的关系

账本里另有 P6 的 `search.unified`（全书统一检索/命令面板）；本行只做章前检索所需的内核与故事索引，工具名 `story_search` 是临时的读入口。统一检索落地时复用它，不再另建第二套索引。

## Alternatives considered

**用子串匹配，不建索引。** 少一个依赖与一份数据库。否掉：源工程是 FTS5/BM25；子串匹配无法按相关度排序，中文也不分词的边界完全不同，等于把检索换成另一种算法。

**引入 better-sqlite3。** 生态更熟。否掉：Node 24 内置 `node:sqlite` 已提供 `DatabaseSync` 与 FTS5，引入原生依赖会让插件多一个编译/安装约束。

**索引放在 DSH storage。** 更「平台化」。否掉：源工程把索引当可重建投影；放作品根内、可删可重建最简单，也符合「作品内容落盘、索引只是索引」的约束。

**每次检索全量重建。** 实现最简。否掉：`replaceScope` 已按内容哈希做增量，成本与全量相当但没有必要每次重写所有行。

## Acceptance criteria

- `LocalSearchIndex` 能在内存库与文件库上 `replaceScope` + `search`；同一 scope 重复写入只更新变化文档，删除的文档不再命中。
- 查询按 BM25 相关度排序，`kinds` 与 `scope` 过滤生效，`limit` 夹在 1..200；空查询返回空数组。
- 中文查询能命中中文文档（分词或 bigram 策略与源一致；测试至少覆盖「伏笔」「角色」这类中文词）。
- `rebuildStoryIndex` 把伏笔、章节摘要、角色卡、素材、大纲装进索引；删除源文件后索引不再返回该条。
- `story_search` 返回 `source` 为作品根相对路径、`kind` 正确、`excerpt` 不超过 200 字；无命中返回 `[]`。
- 索引文件损坏或 schema 版本不符时自动重建，不阻断检索。
- `test/search-index.test.mjs` 覆盖内核；`test/story-index.test.mjs` 覆盖五类文档与重建；`test/host.test.mjs` 工具清单加 `story_search`。
- 实现与证据：implementation `packages/see-dsh-novel/src/core/search-index.ts`；consumer `packages/see-dsh-novel/test/search-index.test.mjs`；realRun `artifacts/real-runs/plan.retrieval.json`。
- 真实运行：在已有基础设定的工作区会话里用 `story_search` 查「伏笔」与一个角色名，核对命中来源与摘要；删掉一张角色卡后重建再查，确认该条消失。

## Risks

- `node:sqlite` 的 FTS5 是否在目标 Node 构建里可用需要在实现时先探测；不可用时本行阻塞，必须先与源工程对齐替代方案（不能用子串匹配冒充）。
- 中文分词策略若与源不同，同一查询的排序会不同；测试只锁「能命中」，排序差异在对照源实现后记录。
- 索引是派生数据，作者手改索引会导致与源文件不一致；`story_search` 每次都先 rebuild，降低这种风险。
- 临时工具 `story_search` 与 P6 的统一检索有重叠，统一检索落地时要合并入口。
