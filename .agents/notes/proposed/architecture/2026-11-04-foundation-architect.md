# Agent Note: foundation.architect —— 四段基础设定与落盘契约

Status: proposed

## Problem

账本第三行之前的那一行要求 architect 以单 child 跑四段（outline / details / cast_index / cards），每段独立 tool schema，产物落成作者可读的文档。这条能力一旦落地，就同时定下了「一部作品在磁盘上长什么样」——后续每个能力都要在这套路径与状态文件上读写。参考资料里这些契约分散在三个文件里（tool schema、写入实现、状态播种），没有任何一处写全。

## Proposal

### 工作区布局（一工作区即一作品）

```
<工作区>/
  source/story/outline/story_frame.md
  source/story/outline/volume_map.md
  source/story/book_rules.md
  source/story/book_rules.json
  source/story/roles/主要角色/<name>.md
  source/story/roles/次要角色/<name>.md
  source/story/state/manifest.json
  source/story/state/current_state.json
  source/story/state/hooks.json
  source/story/state/chapter_summaries.json
  index.sqlite                    # 索引，可重建，不是权威
```

除 `index.sqlite` 外全部是文档或小 JSON；索引不进权威链，删掉可重建。相对路径一律 `/` 分隔，跨平台一致。

作品的身份与 `work.json` 不在本能力内：作品怎么被创建、如何记录元信息归 `runtime.session-binding`。本能力只要求工作区已存在，写之前把 `source/story/` 补齐。

### 四个工具

| 工具 | 输入 | 落点 |
|---|---|---|
| `story_foundation_outline` | `storyFrame`、`volumeMap` | `story/outline/*.md` |
| `story_foundation_details` | `bookRules`（Markdown）、`bookRulesData`（结构化）、`pendingHooks[]` | `book_rules.md`、`book_rules.json`、`state/hooks.json` |
| `story_foundation_cast_index` | `roles[]`，每项 `{ tier: major\|minor, name }` | 不落盘，供下一段生成动态 schema |
| `story_foundation_cast_documents` | `role_<n>_content` 动态字段 | `story/roles/{主要角色\|次要角色}/<safeName>.md` |

`cast_index` 先跑，`cast_documents` 的 schema 按上一步的 `roles` 生成——每张卡一个具名字段，而不是一段 JSON 数组。这样模型无法少交或多交卡片，也不用在字符串里塞 JSON。

角色文件名按 `/\:*?"<>|` → `_` 替换后 trim；替换后为空则整次失败，不静默跳过。

`cast_index` 只用于生成下一段的 schema，不落盘；本阶段人物权威是角色卡文件本身，`roles:index` 这类索引工件由 `cast.single-authority` 定义。

### 写入语义

`story_foundation_outline` / `details` / `cast_documents` 共享一个 `commitFoundation(root, writes, deletes)`：

1. 全部内容先写进 `<root>/source/.staging-<id>/`，并备份将被覆盖或删除的目标文件；
2. 逐项 rename 到位，删除清单里的文件；
3. 任一步失败则用备份回滚，清理 staging。

不引入 journal 持久化：P1 的写入方是单进程单次调用，跨进程恢复属于 `runtime.recovery` 那一行。

`mode` 由调用方给：`init` 只写不删；`revise` 额外删除 `story/roles/{主要角色,次要角色}/` 下本次未重写的 `.md`。删除只在 `revise` 发生，`init` 重跑不动作者已有文件。

### 状态播种

`story_foundation_details` 产出 `pendingHooks` 后，若 `state/hooks.json` 不存在则播种：

```
{ hookId, startChapter: 0, type, status: "deferred", lastAdvancedChapter: 0, expectedPayoff, notes }
```

`manifest.json` / `current_state.json` / `chapter_summaries.json` 同时以空值建立（`lastAppliedChapter: 0`、`{ chapter: 0, facts: [] }`、`{ rows: [] }`）。已存在则不改写——阶段推进归后续能力。

### 工作区解析

工具从 `exec.agent` 取当前会话目录（`ctx.workingDirectory.ensure(agent)`），把它当作品根。不读全局配置、不猜路径；没有 agent 归属（非会话调用）时直接失败，不回退到进程 cwd；目录不可用时报可识别的错误。

### 非目标

- 角色注入 `systemPrompt.context()`（`cast.single-authority` 那一行）
- brief 装配、预算、检索（`context.brief` / `context.retrieval`）
- 作者确认闸门（`foundation.approval`）
- SQLite 索引的建立与查询

## Alternatives considered

**四段合并成一个工具。** 往返更少。否掉：单次输出可达十万字符，失败要整段重来；而且 `cast_documents` 的 schema 依赖 `cast_index` 的输出，合并后动态 schema 的优势消失。

**角色卡用一段 JSON 数组提交。** 结构简单。否掉：模型容易在字符串里塞 JSON、少项或多项；动态具名字段让「每个角色一张卡」成为 schema 层面的约束。

**路径照参考改写为 ASCII（`roles/major`）。** 路径更干净。否掉：导出、备份、素材 sidecar 都按相对路径走，改名会让后续每处都要映射一次，而复刻目标里路径本身就是行为。

**写入直接覆盖，不做 staging。** 实现最省。否掉：四段里任何一段失败都可能留下半套设定，作者看到的是混合了新旧两个版本的作品。

## Acceptance criteria

- 四个工具在预设会话里可调用，schema 各自通过运行时子集校验（单值 `type`、可空用 `oneOf`、动态属性 `additionalProperties: false`）。
- 一次完整 foundation 跑完后，上表路径逐个存在，内容与工具输入一致；`book_rules.json` 是合法 JSON。
- `init` 重跑不删除已有角色卡；`revise` 删除本次未重写的角色卡；两者都整批成功或整批回滚。
- `state/hooks.json` 的条目字段与初值如上；四个状态文件在首次运行时创建。
- 角色名含 `/`、`:` 等字符时落盘为替换后的文件名；替换后为空则失败并保留原状。
- 消费者测试覆盖：路径落盘、init/revise 删除差异、回滚、hooks 播种、schema 子集。
- 真实运行：在一个空工作区跑完一次 foundation，产物与回执写入 `artifacts/real-runs/foundation.architect.json`。

## Risks

- 四段是四次模型调用，任一段超时或输出不合 schema 都会中断；回滚必须真的可用，否则会留下半套文件。
- `cast_documents` 的动态 schema 随角色数增长，角色很多时工具 schema 会很大。
- 状态文件一旦被后续能力写入，`details` 重跑不能覆盖它们；这条边界现在靠「已存在则不改」实现，缺少更细的迁移策略。
- 工作区根来自会话目录，若作者在仓库根直接跑，作品文件会落在仓库根，需要作者自己选对目录。
