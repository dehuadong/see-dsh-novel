# Bootstrap：see-dsh-novel（新仓库初始化交接）

本文件自包含；除源码目录 `inkos` 外，不依赖任何其他工程。

## 0. 源与目标

- 源工程（只读规格）：`inkos`
- 新仓库：`E:\see-dsh-novel`
- 运行时：只用 DSH 原生机制（Skill / Preset / Plugin / Subagent / 文件与 Session 状态），不 import、不运行`inkos`源工程代码，不引入其 Provider、Agent 循环、CLI、存储或调度。

## 1. 新会话入口

在新工作区 `E:\see-dsh-novel` 开新会话，第一条消息：

```text
读取 E:\see-dsh-novel\see-dsh-novel-bootstrap.md，

```

## 2. 铁律（写入新仓库 AGENTS.md）

1. **一个 PR 只做一个纵向能力**：对应 `capabilities.yaml` 的 `id`，同时包含参考证据 → DSH 落点 → 实现 → 消费者 → 契约测试；缺一项 CI 拒绝。禁止只拆文件/只改文档/只改存储的 PR。
2. **状态只来自证据**：`capabilities.yaml` 的 `status` 只能由 `check-capabilities` 依据测试与真实运行证据生成；人工只能写 `missing`。不建第二套状态表、交付盘点、进度看板、“已实现/已验收”清单。
3. **只用 DSH 运行时**：
   - Provider → DSH `llm`；
   - Agent 循环 → DSH agent loop + `subagents`；
   - CLI → DSH command / headless；
   - 存储 → DSH storage/session 或既有 SQLite（不新建独立存储服务）；
   - 调度 → DSH jobs/schedule；
   - 技能 → DSH `skills` 服务 + 文件系统；
   - 上下文注入 → DSH `systemPrompt.context()`，不自定义 prompt 拼装层重复方法正文。
4. **状态只有两种**：`missing` 与 `verified`；不设待重验、旧口径等中间状态。能力状态只由第 2 条的证据生成。

## 3. 第一批文件

```text
E:\see-dsh-novel\
  AGENTS.md
  docs/scope.md                 # 产品范围与非目标
  docs/dsh-mapping.md           # InkOS 机制 → DSH 服务的映射与偏差
  capabilities.yaml             # 全量能力账本（初始全部 missing）
  scripts/check-capabilities.mjs
  package.json
  .gitignore
  .agents/skills/write-agent-notes/
  .github/workflows/ci.yml
```

`docs/scope.md` 写：v1 长篇纵向链路（proposal → init → foundation → 角色权威 → 第 1 章 write/review/revise/summary/settle/finalize → export/backup）；非目标：短篇/剧本（v1 后）、兼容层、旧作品迁移、横向重构、第二套状态表。

## 4. capabilities.yaml：全量、持续更新

不是只有 3 条。账本是**全量能力清单**，初始化时全部 `missing`；随着能力完成，状态变为 `verified`；新发现的能力追加为 `missing`，不删除旧行。

按演进顺序分组（每行字段：`id / title / reference / dsh / implementation / consumer / realRun / status`）：

**运行时与工程**
1. `runtime.load` — 插件/预设加载，注册 `story_next`，client 骨架可见
2. `runtime.session-binding` — 当前作品绑定、面板进入作品
3. `runtime.commands` — DSH command/headless 入口（init/export 至少一条）
4. `runtime.telemetry` — 每次委派的 usage/耗时/失败回执
5. `runtime.recovery` — 自检/恢复（workspace/work 索引重建）

**长篇基础**
6. `foundation.architect` — architect 单 child 四段（outline/details/cast_index/cards），每段 tool schema
7. `foundation.hooks` — pendingHooks 种子、id/status 语义、投影一致
8. `foundation.approval` — 作者确认闸门与回执
9. `cast.single-authority` — `roles:index`/`role:*` 唯一人物权威，major/minor 均进入 brief/context
10. `plan.outline` — 全书计划/卷图
11. `plan.chapter` — 章纲 memo/threadRefs、闸门
12. `context.brief` — 角色 brief 装配、预算、trace、whitelist
13. `context.retrieval` — 摘要/伏笔/卷/素材检索与来源标注

**章节流水线**
14. `chapter.write` — 首版正文
15. `chapter.review` — observations/severity/quote 校验
16. `chapter.revise` — patch/polish/rewrite/deslop
17. `chapter.summary` — 结构化摘要
18. `chapter.settle` — fact/hook 抽取、状态草案、conflict 校验
19. `chapter.finalize` — 定稿与阶段推进
20. `chapter.reopen` — 重开与回滚
21. `chapter.move-delete` — 删章/移章重排、引用与检索同步
22. `state.check` — 语义对账，只读 findings

**产物与面板**
23. `artifact.identity` — 虚拟路径、artifactId/revision、跨作品隔离
24. `export.work` — 导出（原子替换）
25. `backup.restore` — 备份/恢复含素材 sidecar
26. `materials.import` — EPUB/PDF/文本导入、去重、用途
27. `search.unified` — 记忆/素材/技能统一检索
28. `panel.workbench` — 工作台、阶段按钮、作者确认
29. `panel.logs` — 调用日志
30. `panel.analysis` — 分析/节奏

**短篇（v1 后）**
31. `short.outline`
32. `short.batch-draft`
33. `short.review-revise`
34. `short.package`

**剧本（v1 后）**
35. `script.spec`
36. `script.scenes`
37. `script.scriptset`
38. `script.review-revise`

`check-capabilities` 读取该全量表；`status: verified` 必须有：实现路径存在、消费者测试通过、`artifacts/real-runs/<id>.json` 存在且含日期+session id+关键回执。

## 5. DSH 实现计划

### 5.1 架构映射

| InkOS 机制 | DSH 落点 | 说明 |
|---|---|---|
| Provider/模型调用 | `llm` 服务 | 不写 provider；模型选择由预设/配置提供 |
| Agent 循环 | `agent-loop` + `subagents` | 角色 = 子代理；不写自定义 runner loop |
| CLI | `commands` / headless | 不写独立 CLI 进程 |
| 会话/事件 | DSH session log | 对话与调用证据在 session；作品内容另存 |
| 作品存储 | SQLite（一作品一库） | 沿用文件型存储，不引入 ORM/服务 |
| 调度 | `jobs` / `schedule` | 长任务用 subagents 异步；不建队列 |
| 技能 | `skills` 服务（文件系统） | SKILL.md + references 从 `skills/` 读取 |
| 方法注入 | `systemPrompt.context()` | 按 role/action 激活技能，注入 SKILL body + 选定 reference 片段（受预算） |
| 工具 | `tools.register` | `story_*` 工具；每 phase 独立 tool schema |
| 面板 | `client` 插件 + slots | 不写独立前端服务；从会话进入，同顶部的对话、轨迹旁边；UI使用react，具体参考官方文档 E:\see-dsh-novel\deepseek-harness\packages|

### 5.2 实施顺序（每步产出一个 `verified`）

- **P0**：`runtime.load` —— 最小 bundle/preset/tool/skill/client 骨架，CI 通过，真实加载一次；
- **P1**：`foundation.architect` + `cast.single-authority` + `foundation.approval` —— 第一条真实链路（立项 → 基础设定 → 角色进入 brief）；
- **P2**：`plan.outline` + `plan.chapter` + `context.brief`；
- **P3**：`chapter.write` + `review` + `revise`；
- **P4**：`chapter.summary` + `settle` + `finalize`；
- **P5**：`export` + `backup` + `materials` + `search` + `panel.*`；
- **P6**：短篇流水线（独立）；
- **P7**：剧本流水线（独立）。

每个阶段结束时只允许 `check-capabilities --write` 更新状态；不写进度文档。

### 5.3 与参考的差异登记

`docs/dsh-mapping.md` 记录每项机制映射的等价实现与偏差（参考做法 / 我们的做法 / 原因 / 验证），不记录完成状态。

