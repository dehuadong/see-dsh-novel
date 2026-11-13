# DSH 机制映射

记录每项机制在 DSH 上的等价实现与偏差：源工程做法 / 复刻做法 / 原因 / 验证。本文件记录映射设计与偏差，不记录完成状态。

**登记前提**：偏差只有两种合法来源——DSH 机制无法等价，或源行为本身不可观测。能用 DSH 机制等价实现的一律按源行为复刻；「先简化、记一笔」不算合法偏差，算保真债（见 `AGENTS.md`「保真原则」）。

## 映射表

| 机制 | 源工程做法 | 复刻做法 | 原因 | 验证 |
| --- | --- | --- | --- | --- |
| Provider／模型调用 | 自带 provider 与模型路由 | DSH `llm` 服务 | 不重复实现模型接入；模型由预设／配置提供 | 一次角色委派能取得模型回执 |
| Agent 循环 | 自定义 runner 驱动角色 | DSH agent loop + `subagents` | 角色即子代理，循环与上下文由运行时负责 | 一个阶段能派发子代理并收敛结果 |
| CLI | 独立 CLI 进程 | DSH command / headless | 不维护第二套入口与参数解析 | `init`、`export` 各有可执行入口 |
| 会话／事件 | 自建会话与事件存储 | DSH session log | 对话与调用证据留在 session，作品内容另存 | 一次流水线可在 session 中追溯 |
| 作品存储 | 作品内容为落盘文档 | 作品正文与设定落盘为文档，SQLite 只做索引（一作品一库；一个工作区即一部作品） | 正文要可读、可 diff、可直接导出；索引只加速检索，不能成为正文的唯一副本 | 删除索引后能从文档重建；两部作品互不串数据 |
| 调度 | 队列 + worker | DSH jobs／schedule | 长任务用子代理异步执行，不建队列 | 长任务可断点续跑 |
| 技能 | 自有技能目录与加载器 | DSH `skills` 服务：随包 `SKILL.md` 由插件在预设作用域注册（读包内文件，不经文件系统提供者），注册带 `resourceBase` 指向技能目录 | 不自建技能加载层；本组合的宿主 provider 已关，缺什么发现根由预设自己挂；参考文件靠 DSH 的资源基址按需读取 | 写作预设的 agent 看得到随包技能，其它预设看不到；`skill-references.test.mjs` 断言基址与参考文件可读 |
| 方法注入 | 自建 prompt 拼装 | `systemPrompt.context()` | 不在实现里复制方法正文；角色档案整份注入，预算与裁剪留给 `context.brief` | 注入片段可在 trace 中定位 |
| 工具 | 自有工具总线 | `tools.register` | `story_*` 工具按阶段注册独立 schema | 每阶段工具集不同且可校验 |
| 作者确认 | Studio `propose_action` 只确认 workflow start（`create_book`、`write_next` 等 15 项），带 actionPayload／targetSessionKind；确认后 host 执行 | DSH `approval` 服务 + `commands` + `panel.confirm`（P1）；面板/命令/原生确认同一 decision | 原生确认留 `approval/decided` 回执，但与会话权限策略耦合；策略为 `never` 时由面板命令产生回执；plan/write 是 workflow 内部步骤，不逐工具确认 | 无有效回执时不启动 workflow；`panel.confirm` 覆盖 workflow start；`approval.test.mjs` |
| 阶段停点 | 源无“阶段 prompt 自动推进”；workflow start 由作者/命令触发 | `systemPrompt.context()` 只描述当前阶段；阶段完成停下；下一阶段需 workflow start | DSH 阶段上下文是机制等价，不是动作授权 | `runtime.stage-context` 测试；真实回执 |
| 面板 | 独立前端服务；文件/阶段确认/只读产物 | `client` 插件 + slots；`panel.workbench`（P6）是唯一作品页，承载阶段栏、产物列表、详情与动作条；确认语义仍归 `panel.confirm` | 从会话进入，与对话、轨迹并列；UI 用 React；DSH resource 只能按路径订阅，阶段与产物清单由宿主投影的 `panel.index.json` 提供；面板只读、不触发投影 | 索引驱动渲染；动作经宿主命令/提示；`workbench`/`client`/`panel-projection` 测试 |

## 偏差登记

每项偏差按四段记录：源工程做法 / 复刻做法 / 原因 / 验证。相等实现不登记，避免把映射表写第二遍。

### 作品锁：action 边界而不是 commit

- 源工程做法：`StateManager.acquireBookLock` 在 `bookDir/.write.lock` 建锁；`withWorkMutationScope` 做同 async scope reentrancy，`runInWorkMutationQueue` 做 whole-action 串行；`commitAtomicFileSet` 不感知锁。
- 复刻做法：`core/work-lock.ts` 的 `source/.write.lock` + metadata/心跳/lease；`core/work-mutation.ts` 的 `withWorkMutationScope`／`runInWorkMutationQueue`；`withWorkAction` 在 init/foundation/truth/plan/write/review/recover action 入口包锁；commit 保持 lock-agnostic。
- 原因：DSH 的 action 边界是 `story_*` 工具/命令；把锁塞进 commit 会多一层源工程没有的行为，也让读-检查-写仍可能在锁外。
- 验证：`test/work-lock.test.mjs` 的同进程/stale/token/队列/跨进程 child；真实回执 `artifacts/real-runs/runtime.work-lock.json`。

### 作者确认：原生确认条与面板命令双通道

- 源工程做法：Studio `propose_action` 生成确认卡，携带 `action`／`targetSessionKind`／`instruction`／`title`／`summary`／`actionPayload`；`write_next` 是 confirmed production intent；确认后 host 用 confirmed binding 执行 workflow start。plan/write/revise 是 workflow 内部步骤，不逐工具确认。
- 复刻做法：会话策略为 `ask` 时用 DSH 原生确认条，回执落在 `approval/asked` 与 `approval/decided`；策略为 `never` 或没有确认端时改由 `/story-approve` 命令产生回执，签核工具只读最近一次决定。`panel.confirm` 承载确认与回执语义；面板上的入口在 `panel.workbench` 的 `foundation-ready` 节点。
- 原因：出树插件没有自定义 RPC 出口，自造会话事件会让持久化整份拒读；原生确认又与会话权限策略绑死，单一通道在 `danger-full-access` 下恒拒。
- 验证：`packages/see-dsh-novel/test/approval.test.mjs` 覆盖两条通道与各类拒绝；`panel.confirm` 的 workflow start 真机回执；不得把 plan/write 改成逐工具 approval。

### 阶段停点：上下文描述不等于动作授权

- 源工程做法：没有每轮自动推进的阶段 prompt；`book create`／`write_next` 等 workflow start 由作者/命令触发，之后才跑 workflow 内部步骤。
- 复刻做法：`systemPrompt.context()` 注入当前阶段说明；阶段完成必须停下；普通问候/讨论不改作品；下一阶段必须由 workflow start（命令/面板/确认）触发。
- 原因：DSH 的阶段上下文只提供模型上下文，不是授权；把描述当命令会绕过作者确认。
- 验证：`runtime.stage-context` 的测试与真实回执；workflow start 由 `/story-write`/`panel.confirm` 写入前，阶段停在 `foundation-ready`，不得自动 plan/write。

### 面板：确认语义与工作台

- 源工程做法：Studio 的作品页由确认卡（动作）与 `TruthFiles`／`ChapterWorkspacePanel`（产物浏览）组成，同属一个页面；立项在对话里由提案工具完成。
- 复刻做法：`panel.confirm` 只拥有确认与拒绝的语义；`panel.workbench`（P6）是唯一作品页，承载阶段栏、本阶段产物列表与详情，当前阶段的动作在右栏顶部动作条。阶段、产物与确认状态来自宿主投影的只读 `panel.index.json`（`withWorkAction` 成功后重建、会话发布时补建缺失/过旧索引），面板只读该投影，不调用 `/story-index`，也不给新建表单。
- 原因：确认是授权入口，产物浏览是读取面；面板若自己触发投影或重算阶段协议，就会和宿主判定分叉，失败时还会静默回退旧卡。
- 验证：`panel-index.test.mjs`／`workbench.test.mjs`／`client.test.mjs`／`panel-projection.test.mjs`；索引不含独立状态；作者裁定不做桌面回执，以进程级测试为证据。

### 面板产物：白名单、JSON 键值树与诊断折叠

- 源工程做法：真值文件浏览器按显式白名单列文件（`api/server.ts:3228-3240` 的 flat／outline／运行时诊断正则，`api/server.ts:4189-4203` 加角色卡目录），诊断文件带 `readonlyReason: "runtime-diagnostic"` 与只读警示（`pages/TruthFiles.tsx:119-129`），内容统一用 `<pre>`（`pages/TruthFiles.tsx:168`）。
- 复刻做法：面板展示集合同样走白名单（另加章节正文，源在章节页展示）；诊断文件默认收进「运行时诊断」折叠分组，展开后仍是 `<pre>` 原文与同一条警示；作者产物的 JSON（章纲、审稿）用键值树并保留「原始 JSON」切换。`state/*.json`、`memory.db`、`workflow-start.json` 不进面板；审批摘要仍是 `source/story/` 全量。白名单与源一致：不含 `book_rules.json`、两份 brief 与 `planner-context`。
- 原因：白名单让面板只显示作品产物，作者不必在状态 JSON 与 trace 里找正文；键值树与折叠是作者对可读性的裁决，原文切换保证没有信息损失。
- 验证：`panel-index.test.mjs` 断言展示集合与摘要集合分离、类别与出现阶段；`workbench.test.mjs` 断言折叠分组、JSON 键值树与原始切换、诊断警示。

### 面板删除：宿主命令替代直接 API

- 源工程做法：章节工作台页头的「删除本章」在确认后调用 `DELETE /books/:id/chapters/:num`，服务端直接调 `deleteLatestChapter` 并广播。
- 复刻做法：工作台页头的「删除本章」内联确认后调用宿主命令 `/story-delete`；命令在作品锁内读章节索引的最新章号并调 `deleteLatestChapter`，DSH 把命令结果文本显示在对话里；面板只显示「已提交，结果在对话里」，不判断成功或失败。
- 原因：client 插件没有写权限与作品锁，删除必须经宿主命令；DSH 命令注入面只回 `matched`，面板拿不到结果文本，因此不宣称成败。
- 验证：`delete-command.test.mjs`（成功删除与空工作区失败）、`workbench.test.mjs`（页头按钮与内联确认）、`client.test.mjs`（`/story-delete` 映射与提示）。

### chapter.revise：修订后由审稿闸门替代自动复审

- 源工程做法：`pipeline/runner.ts:874-1120` 的 `reviseDraft` 在修订事务内 `collectReviewObservations` 复审修订稿，把观察写回章节 index；状态结算与校验也在同一事务。
- 复刻做法：`story_revise_chapter` 覆盖章节文件后删除旧审稿记录，并在没有 start 时同批重开本章（`workflow-start.json`），阶段回到 `review`；审稿观察由主编派审稿子代理产出，再经 `story_review_chapter` 校验落盘；重结算由 `story_settle_chapter` 单独完成（可重入）。
- 原因：DSH 的审稿观察与结算 delta 都是模型输出，工具内不能跑模型；阶段闸门保证修订后必须重审，再结算由作者/协议触发。
- 验证：`test/chapter-revise.test.mjs` 断言修订后审稿文件消失、`reviewInvalidated`；`test/stage-context.test.mjs` 断言 review／chapter-done 协议写明重审。

### chapter.revise：局部修订范围由主编随正文提交

- 源工程做法：`revise_chapter` 只收 `targetText`；未给时 reviser 在内部提交 `ranges`（`agents/reviser.ts:96-105`），`utils/text-range-edits.ts:40-59` 逐段替换并保留其余字节。
- 复刻做法：主编把 reviser 子代理选出的 `ranges` 与每段 `replacements` 一起提交 `story_revise_chapter`；宿主逐段替换正文构造结果，并与 `chapterBodyForChapter` 归一后的整段 `content` 逐字节比对，范围外必须逐字节不变。
- 原因：DSH 的修订正文由子代理整段返回，宿主拿不到内部替换字段；不声明范围就无法区分多段局部修订与范围外改动。
- 验证：`test/chapter-revise.test.mjs` 的多段成功、范围外拒绝、范围非法与 `targetText` 任意 mode 用例；参数形状错误复用 `ARTIFACT_EDIT_RANGE_INVALID` 也由这些用例覆盖。

### chapter.revise：缺索引行时追加修订条目

- 源工程做法：写章节时已有章节索引行，`reviseDraft` 直接 `index.map` 更新当前章与后代；缺行不会发生。
- 复刻做法：索引在定稿才写；修订时若缺当前章行，`revisedChapterIndex` 追加一条 `edited` 行（`createdAt = updatedAt`），已有行保留 `createdAt`。
- 原因：DSH 把章节索引写入放在 `chapter.finalize`，修订早于定稿；追加让修订后的索引反映当前正文。
- 验证：`test/chapter-revise.test.mjs` 的「无索引行时追加」与「已有行保留 createdAt」用例。


### chapter.reopen：恢复正文与重开回退分开

- 源工程做法：`chapter-replace` 对任意章可用，只替换正文、归档旧稿、清该章 `chapter-NNNN.*` 运行时文件（保留 user-brief）并记索引观察，不动运行时状态；源用 `requiresTruthRebuild` 标出后续重建。
- 复刻做法：`story_reopen_chapter` 按 `versionId` 分流。恢复分支对任意章可用：替换正文、归档当前为 `restore`、清运行时，不改指针/摘要/facts/hooks、不写索引；重开分支只对最后已结算章：保留正文、清运行时、写或沿用 workflow start，把 `manifest.lastAppliedChapter` 与 `current_state.chapter` 退回上一章，并删除该章摘要行。
- 原因：DSH 的阶段判定用 `current_state.chapter` 找下一章；指针不回退会把重开的章判到下一章。摘要行删除属于重开回退，不是源恢复；源恢复没有对应动作。
- 验证：`test/chapter-reopen.test.mjs` 断言恢复任意章不动状态、重开清运行时/保留 user-brief/指针回退/摘要删除/start 写入或沿用；`test/stage-context.test.mjs` 断言 plan 段的条件修订指令。D36（恢复写索引观察）与 D58（重开回退不恢复 facts/hooks、恢复后重审不可达等）仍保留；D33 已由 [chapter.settle 基线重算](../.agents/notes/implemented/architecture/2026-11-13-chapter-settle-baseline.md) 注销。

### backup.restore：工作区内的备份与恢复

- 源工程做法：整本作品目录 `cp` 到 `<projectRoot>/.inkos/backups/<bookId>/<stamp>/`；恢复先做 `pre-restore` 备份，再 `rm(bookDir)` + `cp` 整目录；作品身份文件坏掉也能备份/恢复。
- 复刻做法：备份 `work.json` 与 `source/`（作品拥有项）到 `<workspace>/.backups/<backupId>/`，不读 `work.json`；恢复只替换这两项，保留工作区根的 `.git`、作者文件、导出文件、`.backups/` 与活动锁；恢复前先回收死事务，回收失败把 `.inkos-file-txn-*` 隔离为 `.dead-txn-*` 后继续。
- 原因：DSH 没有“项目根 + `works/`”层级，工作区是命令唯一稳定根，且工作区根可能同时是仓库根（`/story-init` 已同因裁定不删根）；复刻的提交事务目录在作品根，恢复是裸 fs 写入，不先回收会让下一次 commit 用旧事务备份覆盖恢复内容。
- 验证：`test/backup.test.mjs` 的拥有项复制/排除、id 与列表、恢复替换与根文件保留、坏 `work.json`、空工作区 `preRestoreBackupId: null`、死事务隔离、命令参数边界；根上导出文件不回滚是 D38。

### export.work：导出回执从原生 alert 改为页面内 notice

- 源工程做法：Studio 导出按钮 POST `/export-save`，成功后 `alert("已导出到项目目录\n<path>\n(N 章)")`，失败 `alert(e.message)`（`studio/src/pages/BookDetail.tsx:389-401`）。
- 复刻做法：`StoryView` 的导出动作走 `executeCommand`（`remote.commands.execute`），把命令处理器回执文本写进动作条 notice：成功含落盘路径、章数、字数、字节数，失败含错误文本；回执不跨视图保留。
- 原因：DSH client UI 规范用页面内反馈面（成功可用 Toast、surface-owned 失败用 in-place notice），不引入原生 `alert` 模态；成功与失败都选与导出按钮同一处的 notice，保持单一入口。
- 验证：`test/client.test.mjs` 的导出回执用例与 `executeCommand` 桥接用例；`artifacts/real-runs/export.work.json`。

### 就绪判据：角色卡只能由会话路牌数

- 源工程做法：状态接口用 `isBookFoundationComplete` 判断完成——六份文件（作品身份、大纲两份、book rules 两份、伏笔池）加 `story/roles/` 任一目录里的至少一张角色卡。
- 复刻做法：`story_next` 按同一份清单判 `ready`；面板的阶段与产物一律来自宿主投影的 `panel.index.json`（`story_next` 的判据在宿主侧），client 不数文件；没有索引时只保留「开始基础设定」的兜底入口。
- 原因：客户端资源通道按路径订阅，没有列目录能力，`story/roles/` 下有什么文件客户端拿不到；因此「≥1 张角色卡」只能由宿主侧判。
- 验证：`packages/see-dsh-novel/test/ready-check.test.mjs` 覆盖七项判据与四个角色目录；`test/host.test.mjs` 覆盖四阶段与 `draft` 的两种下一步；`client.test.mjs` 覆盖索引驱动与无索引兜底。

### 控制文档：语言由调用方解析，写入项并入同一次提交

- 源工程做法：`loadControlDocuments(bookId)` 自己读 `book.json` 解析语言并直接落盘；`ensureControlDocuments` 建目录、写默认模板。
- 复刻做法：`controlDocumentWrites(root, language)` 建目录并返回缺失文件的写入项，调用方（三个真值写入工具）用 `projectionLanguage` 解析语言后并入同一次 `commitFoundation`；`readControlDocs(root, language)` 读取前先补默认。
- 原因：core 不读作品身份（语言由管线层解析），且所有真值写入走同一次原子提交，写入项比直接落盘更能保证「要么全成、要么不动」。
- 验证：`packages/see-dsh-novel/test/control-docs.test.mjs` 覆盖目录骨架、只补缺失、中英模板与读取默认；`test/foundation.test.mjs` 断言 outline 与 details 的写入集合包含两份方向文档。

### 伏笔 id：记录唯一性由复刻自己校验

- 源工程做法：`HooksStateSchema` 只校验数组形状与单条记录的字段，不要求 `hookId` 在数组内唯一；重复 id 会一起存下来，后续按 id 归并时才隐式覆盖。
- 复刻做法：`validateHooks` 拒绝重复的 `hookId`，报错点名重复的那个 id。
- 原因：复刻的状态读写以 `hookId` 为索引（投影排序、计数、结算合并都按 id 归并），重复 id 会让读到的状态与写入的不一致，且没有可观察的修复点。
- 验证：`packages/see-dsh-novel/test/hooks.test.mjs` 的 `hookId 重复` 用例。

### plan.compression：memory 分组预算按 DSH 子代理输出预留

- 源工程做法：`groupMemoryCandidates` 用 `semanticInputBudget(client,{reservedOutputTokens:2048,promptOverheadTokens:2048})` 分组，选择调用的输出上限是 2048。
- 复刻做法：D25 分组用 `contextWindow - reservedOutputTokens - 3072`；`reservedOutputTokens` 取自模型 `maxTokens`（当前 256k），每个选择任务交给 DSH subagent。
- 原因：DSH subagent 的输出预算由模型 `maxTokens` 决定，不能在调用级设 2048；照搬源的 2048 会让选择请求本身接近 1M 窗口，无法放进模型。分组更保守，选择结果与 candidate 映射不变。
- 验证：`test/context-package.test.mjs` 的 D25 分组用例；`test/context-spool.test.mjs` 的句柄读取；真实运行 `artifacts/real-runs/plan.compression.json` 记录派生窗口与 D26 证据缺口。

### artifact.identity：产物 manifest 独立于作品身份文件

- 源工程做法：`WorkManifest.artifacts` 嵌在作品 manifest 里，`stageArtifactRevision` 同时写 revision 文件与 manifest；章节 revision 的 `path` 由调用方给，指向 `source/chapters/...`，不复制正文。
- 复刻做法：`source/artifacts/manifest.json` 独立记录 `workId`、artifact、revision、current、checksum、byteLength 与 `snapshotPath`；`writeChapterDocument` 同一次提交写章节文件、manifest 与该 revision 快照；章节 revision 的 `path` 仍指向章节文件，`snapshotPath` 指向 `source/artifacts/<artifactId>/revisions/<rid>.md`。
- 原因：复刻的 `work.json` 是作品身份文件，产物索引可重建；把 artifacts 混进身份会耦合身份校验与产物状态。DSH 单工作区一作品，跨作品隔离由工作区边界保证。
- 验证：`test/artifact-store.test.mjs` 覆盖 stage/promote/current、checksum、parent、ID/路径、快照回填；`artifacts/real-runs/artifact.identity.json` 记录 r1/r2 的 `snapshotPath` 与 `reviewedArtifact`。

### artifact.identity：章节 revision 快照布局

- 源工程做法：快照写在作品内 `revisions/<artifactId>/<revisionId><ext>`（工作根 `works/<workId>/` 下），`snapshotPath` 是作品内相对路径。
- 复刻做法：快照写在 `source/artifacts/<artifactId>/revisions/<revisionId>.md`，`snapshotPath` 是相对工作区根的路径。
- 原因：复刻的作品根就是工作区，artifacts 集中在 `source/artifacts`；两种路径都由各自的作品根解析。
- 验证：`readArtifactRevision` 按 `snapshotPath ?? path` 解析并校验 checksum；`test/artifact-store.test.mjs` 与 `test/chapter-revise.test.mjs` 覆盖快照读取、回填与错误码。

### runtime.commands：建书后启动基础设定

- 源工程做法：`book create` 在命令里同步调用 `createBookFoundationTool`，跑完基础设定后打印完成行。
- 复刻做法：`/story-init` 写身份、brief 与方向文档，然后用 `invocation.agent.followup` 投一条基础设定指令；命令立即返回「已启动」，模型在下一轮按 `story_next` 完成 outline／details／角色卡。
- 原因：命令处理器不能同步等待一次模型生成；DSH 的 `Agent.followup` 是启动后续回合的机制。源行为等价点是「一条命令启动基础设定」，完成回执在后续回合。
- 验证：`test/work-command.test.mjs` 覆盖 followup 一次、消息内容/source、init 失败不投、followup 失败回执；真实运行回执在 `artifacts/real-runs/runtime.commands.json`。

### runtime.commands：重新立项的清理范围

- 源工程做法：`book create` 遇到不完整作品目录时 `rm(workDir,{recursive:true})` 后重建；完整作品拒绝。
- 复刻做法：`/story-init` 判六项 foundation 探针；完整拒绝，不完整删除内容根 `source/` 与根 `work.json`，不删工作区根、不碰 `source/` 外文件。
- 原因：DSH 的工作区根就是作品根，不能删除根（会连 `.git` 与作者文件一起删）；用命令拥有的内容根替代 workDir。
- 验证：`test/work-command.test.mjs` 覆盖完整拒绝、清理重建、`source/` 外文件保留、坏 `work.json` 重建；真实运行回执在 `artifacts/real-runs/runtime.commands.json`。

### `/story-init --brief`：简报路径相对工作区根解析

- 源工程做法：CLI `book create --brief <path>` 从进程当前目录读取简报文件。
- 复刻做法：`/story-init --brief <path>` 相对当前工作区根解析，路径必须留在工作区内。
- 原因：DSH 命令没有独立的进程 cwd，命令能拿到的稳定根只有会话工作区；用工作区根解析也让「简报属于作品」这件事可预期。
- 验证：`packages/see-dsh-novel/test/work-command.test.mjs` 的 `--brief` 用例（含 `../x.md` 被拒绝）。
