# Agent Note: plan.retrieval —— FTS5 故事索引与 BM25 检索

Status: implemented

## Problem

章前规划要先按任务目标检索到伏笔、章节摘要、角色卡与素材。源工程的检索内核是 `retrieval/local-search.ts`：`node:sqlite` 的 `DatabaseSync`，文档表 + FTS5，`replaceScope` 增量重建，`search` 用 BM25 并按 scope/kind 过滤。复刻侧没有索引，也没有检索入口。

## Decision

新增 `packages/see-dsh-novel/src/core/search-index.ts`：

- `LocalSearchIndex(path)`：`node:sqlite`，`retrieval_documents` 表 + `retrieval_fts` FTS5 表；
- `replaceScope(scope, documents)`：按内容哈希跳过未变文档，事务内 upsert 与删除；
- `search(query, {scope, kinds?, limit?})`：BM25 排序（对外取负值使「越大越相关」），limit 1..200，返回 `{id, scope, kind, source, title, body, score}`；
- `segmentCjk(text)`：CJK 逐字加空格；写入与查询两侧同时使用，查询里的 CJK 词转成短语（`"身 份"`），拉丁词用前缀通配（`"Hook"*`）。

新增 `src/core/story-index.ts`：`rebuildStoryIndex(root)` 把五类文档装进 scope = 作品 id：伏笔（`state/hooks.json`）、章节摘要（`state/chapter_summaries.json`）、角色卡、素材、大纲（按 `##` 分节）；索引文件 `source/.index/retrieval.db`。`searchStory` 每次先重建再检索。

新增只读工具 `story_search`（`src/pipelines/long/search-tool.ts`）：`query` 必填、`kinds?`、`limit?`，返回 `{source, kind, title, excerpt, score}`，excerpt 截 200 字；无命中返回空数组。

## Alternatives considered

**子串匹配，不建索引。** 少依赖。否掉：源工程是 FTS5/BM25，子串匹配的分词与排序都不同，等于换算法。

**better-sqlite3。** 生态熟。否掉：Node 24 内置 `node:sqlite` 已带 FTS5，避免原生依赖。

**索引放 DSH storage。** 更平台化。否掉：源工程把索引当可重建投影，放作品根内可删可重建最直接。

## Consequences

收益：作品有了可重建的 FTS5 索引与 BM25 检索；五类文档按作品 scope 建库，增量更新；中文可命中。

验证见 `test/search-index.test.mjs`（匹配、排序、过滤、空查询、增量更新与删除）与 `test/story-index.test.mjs`（五类文档、Markdown 分节、删角色后重建不再命中）；`test/host.test.mjs` 工具清单含 `story_search`。

代价与已知限制：

- 索引是派生数据；`story_search` 每次先重建，作者手改数据库会被覆盖。
- CJK 逐字短语与源 FTS5 的 bigram 行为未必逐字一致，排序差异待对照。
- `story_search` 与 P6 的 `search.unified` 重叠，统一检索落地时应合并入口。
- 不含上一章正文与角色关系推理；前者留给上下文选择行。
