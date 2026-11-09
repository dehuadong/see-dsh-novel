# Agent Note: plan.retrieval —— FTS5 故事索引与 BM25 检索

Status: implemented

> 本篇部分被 [2026-11-08-plan-retrieval-source.md](2026-11-08-plan-retrieval-source.md) 取代：检索内核、故事记忆三类型、metadata、索引路径与 `kinds` 以新篇为准；本篇只保留 `story_search` 入口与早期索引的历史决定。

## Problem

章前规划要先按任务目标检索到伏笔、章节摘要、角色卡与素材。复刻侧原先没有索引，也没有检索入口；`story_search` 是为此新增的只读工具。

## Decision

- 保留 `story_search` 只读入口：`query` 必填、`kinds?`、`limit?`，返回 `{source, kind, title, excerpt, score}`，excerpt 截 1000 字；无命中返回「没有命中。」
- 索引是派生数据，每次检索前重建；`source` 是作品内路径，`kind` 是文档类型，`score` 对外是越大越相关。
- 检索内核、文档类型、metadata 与索引路径以 [2026-11-08-plan-retrieval-source.md](2026-11-08-plan-retrieval-source.md) 为准；本篇不再重复逐字 CJK 或五类文档的旧实现。

## Alternatives considered

**子串匹配，不建索引。** 少依赖。否掉：源工程是 FTS5/BM25，子串匹配的分词与排序都不同，等于换算法。

**better-sqlite3。** 生态熟。否掉：Node 24 内置 `node:sqlite` 已带 FTS5，避免原生依赖。

**索引放 DSH storage。** 更平台化。否掉：源工程把索引当可重建投影，放作品根内可删可重建最直接。

## Consequences

收益：作品有了可重建的 FTS5 索引与 BM25 检索；作者可以用 `story_search` 从一个只读入口查故事记忆。

代价与已知限制：

- 索引是派生数据；`story_search` 每次先重建，作者手改数据库会被覆盖。
- 内核分词、文档类型与排序以新篇为准；本篇不再承诺逐字 CJK。
- `story_search` 与 P6 的 `search.unified` 重叠，统一检索落地时应合并入口。
- 不含上一章正文与角色关系推理；前者留给上下文选择行。
