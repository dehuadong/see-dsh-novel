# Agent Note: plan.retrieval —— 源检索内核、故事记忆与过渡候选

Status: implemented

## Problem

审计 D10 写「CJK 逐字 vs unicode61；缺 skill 参考资料等 scope」，但源实现不是 unicode61：`retrieval/local-search.ts` 用 `Intl.Segmenter` 切词，再补汉字 bigram 与带连字符的复合词；schema 是 `retrieval_documents`＋external-content FTS5，带 `title_tokens`／`body_tokens`／`metadata_json`／`content_hash`，BM25 权重 5／1，`score = -rank`。复刻原先的 `search-index.ts` 是逐字 CJK、前缀通配、独立 FTS 表、无 metadata、默认 BM25、分数四舍五入。

文档类型也不该混在一个 scope：源故事记忆只索引 `chapter-summary`／`hook`／`volume-summary`（`utils/memory-retrieval.ts`）；角色/大纲是 `composer` 的固定来源，素材是 `archived-materials` scope（`materials/retrieve.ts`），技能引用是 `use_skill.query` 的独立 scope（`agent/skill-tool.ts`）。复刻原先的 `story-index.ts` 把 hook／summary／role／material／outline 混在一个 scope，缺 volume-summary，也把别行的事实混进了检索行。

## Decision

### 能力行定义

`plan.retrieval` 的 `source` 是 `retrieval/local-search.ts`＋`utils/memory-retrieval.ts`；`title` 是「章前检索：FTS5/BM25、故事记忆与来源标注」。角色/大纲已由 `plan.context-select` 接管；素材只在过渡期以 D22 保留候选。实现与消费证据落在 `src/core/story-index.ts` 与 `test/story-index.test.mjs`，内核测试在 `test/search-index.test.mjs`。

### 内核

`core/search-index.ts`：

- `SearchDocument.metadata?`、`SearchHit.metadata`；
- `retrieval_documents` 用源的列与 `UNIQUE(scope, document_id)`；`retrieval_documents_fts` 用 external-content＋三个触发器；没有逐字 CJK 的 `segmentCjk`；
- `tokenizeSearchText` 做 NFKC／小写、`Intl.Segmenter` 词切分、汉字相邻 bigram 与连字符复合词；`buildMatchQuery` 把去重 token 加引号后用 `OR` 连接；`splitMarkdownForSearch` 返回 heading／body／charStart／charEnd；
- `replaceScope` 的内容哈希含 metadata；`search` 用 `bm25(…, 5.0, 1.0)`、`score = -rank`、`rank ASC, document_id ASC`、limit 1..200，返回 metadata；
- 旧 `source/.index/retrieval.db` 不迁移；新库在 `source/story/memory.db`，首次检索重建。

### 故事记忆

`core/story-index.ts` 对齐源 `memory-retrieval`：

- scope `story-memory`，库 `source/story/memory.db`；
- 源 `source` 字段是 bookDir-relative 的 `story/...`；复刻的作品内容根是 `source/`，所以落成 `source/story/...`，这是工作区布局映射；
- hooks：`kind:'hook'`、source `source/story/pending_hooks.md#<hookId>`、metadata `{hookId}`、title `hookId type`、body `status/expectedPayoff/notes`，过滤 `resolved`／`superseded`；
- summaries：`kind:'chapter-summary'`、source `source/story/chapter_summaries.md#<chapter>`、metadata `{chapter}`、body 六字段（characters／events／stateChanges／hookActivity／mood／chapterType）、title 缺省 `Chapter N`；
- volume summaries：读 `source/story/volume_summaries.md`，按 `##` 分节，`kind:'volume-summary'`、source `source/story/volume_summaries.md#<anchor>`、metadata `{index}`；
- `storyDocuments` 构造文档，`rebuildStoryIndex` 写索引，`searchStory` 重建后检索；
- `collectCandidates` 把三类记忆映射到 memory，并把未命中的全部文档以 `-1_000_000` 补进候选（源 `memory-retrieval` 的 allCandidates）；命中上限按源 200。

### 过渡候选 D22

- 角色、大纲已由 `plan.context-select` 的固定来源与选择接管并从 `story-index` 删除；素材仍是过渡候选，等 P6 的 materials 接管后删除；
- 素材候选仍走 `-1_000_000` 的非命中补入；D22 已缩小为素材；
- 审计 `plan.retrieval` 行不把素材写成「等价」的一部分，只写成过渡。

### 技能引用 D23

- 源 `use_skill.query` 在 `skill:<id>` scope 检索参考段落；DSH 的 `skill` 工具只加载整份技能，没有 query 入口；
- 插件可以读 skill 的 `resourceBase`、用同一套 FTS 内核做参考检索，所以这是可实现的缺失，不是机制偏差；
- D23 归 `skill.references` 新行/工具，不记在 `plan.retrieval` 行，本行不造第二套技能索引。

### 语义选择器与素材

- 源 `memory-retrieval` 的 BM25 之后还有语义选择；复刻把它留给 `plan.context-select`（D11／D12），本行只返回候选；这是既有能力边界，不在本行重复。
- 素材的 `archived-materials` scope、metadata 与 char 范围归 `materials.import`／`search.unified`（P6）；本行只保留过渡 material 候选（D22）。

## Testing

- `test/search-index.test.mjs`：NFKC/lower、Segmenter 词、汉字 bigram、复合词、引号 OR、短拉丁过滤、metadata、BM25 标题 5/正文 1 的排序、增量与删除；
- `test/story-index.test.mjs`：三类型、hook 状态过滤、summary 六字段、volume summaries、metadata/source、`story/memory.db` 与 `story-memory` scope；素材过渡候选保留并标注 D22；
- `test/context-package.test.mjs`：三类记忆 → memory 映射，未命中的记忆/过渡候选仍进入候选集；
- `pnpm run verify` 295 例通过；真实运行 `session-6474765f-8537-4577-b53c-94b5a2eab9fd`（工作区 `.artifacts/work-retrieval`）返回 hook／chapter-summary／volume-summary 命中、resolved hook 过滤与过渡 role/material 候选，回执见 `artifacts/real-runs/plan.retrieval.json`；`plan.context-select` 删除 role／outline 后，素材仍保留。

## Alternatives considered

- **保留逐字 CJK + 前缀通配** — 最强理由：改动小，现有中文能命中。否掉：源是 `Intl.Segmenter`＋bigram，逐字与前缀会改变召回与排序；不是等价实现。
- **B：保留五类型统一搜索作为最终形态** — 最强理由：作者入口已经存在，角色/素材/大纲能直接搜。否掉：源规划器的记忆只有三类型；用 FTS 供角色/大纲会让 `plan.context-select` 的固定来源债被藏进 `plan.retrieval`，账本说不清。
- **直接删掉角色/大纲/素材候选** — 最强理由：一步到位，不留混合行。否掉：`plan.context-select`／P6 落地前规划器会暂时失去这些候选；D22 是更诚实的过渡。
- **把技能引用登记为机制偏差** — 最强理由：DSH `skill` 确实没有 query 入口，能少做一块。否掉：插件可以读 `resourceBase` 用同一内核做检索，属于可实现的缺失；按 AGENTS 只能记债，不能记偏差。
- **本次一起做 materials 的 archived-materials scope** — 最强理由：同一内核，顺带补齐。否掉：素材导入与统一检索属于 P6；本行只保留过渡 material 候选。

## Consequences

收益：检索内核的 tokenizer、schema、metadata、BM25 权重与分数与源一致；故事记忆回到源三类型，hook 过滤、六字段 summary、volume summaries 与 `memory.db` 路径都可验证；候选集不再只含 FTS 命中，未命中的记忆也进入 `collectCandidates`。

代价与已知限制：

- `Intl.Segmenter` 依赖 Node 的 ICU；双端切分可能有细微差异，测试用源测试的固定短语。
- external-content FTS5 的触发器要在 Windows/Ubuntu 双端跑通。
- 索引路径从 `source/.index/retrieval.db` 改到 `source/story/memory.db`；旧索引不迁移，首次检索重建。
- D22 的素材必须随 P6 删除，D23 必须在 `skill.references` 落地时偿还。
- 能力行 title／source 的更新改变了账本里这一行的定义；必须与审计、范围、测试同批维护。

早期索引与 `story_search` 入口的历史决定保留在 [2026-11-06-plan-retrieval.md](2026-11-06-plan-retrieval.md)；本篇接管内核与故事记忆的现行事实。
