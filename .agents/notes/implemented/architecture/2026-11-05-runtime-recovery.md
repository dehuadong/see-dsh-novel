# Agent Note: runtime.recovery —— 工作区自检、索引重建与残留暂存回收

Status: implemented

## Problem

作品的真相在文件里，但文件会被人手动改动，也会被进程崩溃留在半路：

- 作者手滑删了 `source/story/state/manifest.json` 或 `current_state.json`，`story_next` 只会说阶段，不会告诉他少了索引；
- `commitFoundation` 先写暂存目录 `source/.staging-<uuid>`、再逐个 rename；进程若在 rename 之间被杀，目录里留下 staged 文件与旧文件备份，没有任何东西会去认领它——提交原语本身不记阶段，也就无从判断改到哪一步。

参考工程有两半对应：`chapter-state-recovery.ts` 在审阅后按正文重算这一章的结算层，不一致就带观察报 `unresolved`；`atomic-file-set.ts` 的 `recoverAtomicFileSets` 扫 `.<prefix>-*` 事务目录，读 `journal.json`，属主进程已死时按阶段回滚后删除。第一半是**章节级**对账，需要章节文件、结算层与校验器（P2／P3）；第二半是**提交级**回收，现在就能做。

本行交付：一个自检工具（报告 + 可修则修），覆盖「索引缺失」与「提交残留」两类；章节级对账明确留给章节流水线。

## Decision

### 自检与修复是两步

工具 `story_recover`，参数 `apply`（布尔，默认 `false`）：

- 默认只扫描、返回发现清单，不写任何文件；
- `apply: true` 时只修**无歧义**的项（重建缺失索引、回收属主已死的提交残留），修完重新扫描，把动过的路径列进 `applied`。

扫描与修复规则放在 `src/core/recovery.ts`：纯函数给出发现，执行壳只负责写盘与措辞。

### 提交日志：让回收有依据

`commitFoundation` 增加一个轻量的 `journal.json`，写在暂存目录内：

```json
{ "version": 1, "pid": 12345, "phase": "prepared", "writes": ["source/story/outline/story_frame.md"], "deletes": [] }
```

- staging 建好、备份做完、rename 之前写 `phase: "prepared"`；
- 全部 rename 与删除成功、清理暂存之前改写 `phase: "applied"`。

不引入跨进程锁，也不做恢复线程：日志只是在崩溃后让下一个人能判断「这批文件改到哪一步了」。

阶段标记的写是**尽力而为**：`prepared` 写成失败就不进入 rename（本来就该放弃这次提交）；`applied` 写成失败**不能**回滚已经 rename 成功的文件——提交事实上已经完成，只是少了一个标记。这时先把 `journal.json` **删掉**再清理暂存目录：留下的目录必须没有可回滚的日志，否则一个「属主已死 + prepared」的残留会被回收规则当成「没写完」而把已应用的文件回滚掉。清理若也失败，目录里没有 journal，回收只报 `staging-unknown`。`commitFoundation` 的 `catch` 只覆盖 rename 之前的阶段，`applied` 标记的失败不进入那条回滚路径。

### 回收规则

扫描 `source/.staging-*` 目录：

- 有 journal 且 `pid` 还活着 → `staging-active`（`info`，不修）：那是一次正在进行的提交，碰它会把并发写弄坏；
- 有 journal、属主已死、`phase: "applied"` → `staging-cleanup`（`info`，**可修**）：文件都已就位，只删暂存目录；
- 有 journal、属主已死、`phase: "prepared"` → 按进展分两种：这次提交有写入、且 `work/` 里已经没有 staged 文件，说明 rename 全做完了、只差标记，记 `staging-cleanup`；否则（还有 staged 文件，或这次提交只有删除项、没有东西可看）记 `staging-rollback`（`warning`，**可修**）——把 `backup/` 里的旧文件写回，写了但原本不存在的目标删掉，然后删除暂存目录；
- journal 读不出来（写了一半、JSON 坏了、`phase` 不是两个已知值）→ `staging-unknown`（`warning`，不修）：和「没有 journal」一样，判断不了就只报告；
- 没有 journal → `staging-unknown`（`warning`，不修）：无法判断 rename 到哪一步，留给人工检查，不猜。

「`prepared` 但 staged 已搬空」这一条专门兜住「`applied` 标记没写成、删日志也失败、清理也失败」的叠加情况：那种残留日志还是 `prepared`，但工作已经做完，按 `work/` 是否为空就能判出来，不会被误当成没写完而回滚。

`commitFile` 也会留痕：它在目标目录写 `.tmp-<pid>-<uuid>`（本行把原来的 `.tmp-<uuid>` 加上 pid），rename 之前崩溃就把临时文件留在原地。工作区根（`work.json`）与 `source/story/**` 里都可能出现；后者里时还会计入工件摘要。回收时按 pid 判属主：属主已死的才删（`tmp-residue`，`warning`，**可修**）；属主活着的是另一个正在写的进程，保留；文件名不带 pid（旧格式）的无法判活，只报告。临时文件从未成为目标内容，删除是安全的，删除后摘要回到应有的值。

属主判定用 `process.kill(pid, 0)`：抛 `ESRCH` 即已死；`EPERM` 视为活着（不是本用户的进程也不能碰）。

### 索引重建

`source/story/state/` 下的三个**索引**文件缺失时，按 foundation 段播种的默认内容写回：

| code | 判据 | severity | 可修 |
| --- | --- | --- | --- |
| `unbound` | 既没有 `work.json`，也没有 `source/story/` | `info` | 否 |
| `work-missing` | 有 `source/story/` 内容却没有 `work.json` | `warning` | 否（标题要作者给） |
| `work-invalid` | `work.json` 存在但解析失败 | `error` | 否（身份不自动改写） |
| `foundation-empty` | 已立项，但 `source/story/` 下没有文件 | `info` | 否 |
| `state-missing` | `manifest.json`／`current_state.json`／`chapter_summaries.json` 缺失，且已有其它工件 | `warning` | **是** |
| `hooks-missing` | `hooks.json` 缺失，且已有其它工件 | `warning` | 否（伏笔池是创作事实） |

默认内容从 `state.ts` 取出共用：`stateWritesIfMissing` 改为调用一个导出的 `defaultStateFiles(hooks)`，自检只取其中三个、**不写 hooks**，所以两边不会漂移。默认值原样是 `manifest: { schemaVersion: 2, language: 'zh', lastAppliedChapter: 0, projectionVersion: 1 }`、`current_state: { chapter: 0, facts: [] }`、`chapter_summaries: { rows: [] }`。

### 摘要与确认：索引也在摘要里

`source/story/` 下的**所有**文件都进工件摘要（`core/artifacts.ts` 只扫这一个目录），三个索引文件也不例外。所以：

- 重建写回的内容若与缺失前**完全一致**（foundation 播种后从未被章节推进过），摘要回到原值，作者之前的确认仍然有效；
- 若内容不同（例如章节已推进、`lastAppliedChapter` 不是 0），摘要会变，**旧确认随之失效**——这是正确行为。

工具在修复前后各算一次摘要，并且**不只报摘要**：它从会话里读最近一次认可的回执摘要（复用 `core/receipts.ts` 的 `latestDecision` 与 `parseApprovalMarker`），在输出里给出 `digestBefore`、`digestAfter`、`approvedDigest`（没有认可就是 `null`）与 `needsReconfirm`（`approvedDigest !== null && approvedDigest !== digestAfter`）。

这样作者不必自己比对两串哈希：`needsReconfirm: true` 就是「修完之后要重新确认」。工具不替作者确认，也不把 `state-missing` 说成「不影响确认」——缺失时摘要必然与缺失前不同（文件不在集合里），不能拿「前后摘要」证明恢复得对不对；能证明的是「修复后的摘要是否还等于作者认可过的那一版」。

回收暂存目录与删除 `.tmp-*` 不改工件内容（临时文件不是目标内容），摘要回到应有的值。

### 章节级对账为什么不在本行

参考工程的 `chapter-state-recovery.ts` 需要「这一章的正文、结算产物、状态校验器」，三者都属于 P2／P3。现在做它只能对空数据跑，或者把「按正文重算」简化成写默认值——那正好是参考工程拒绝的做法（它宁可报 `unresolved` 也不伪造一致）。所以章节级对账等章节流水线落地后再按本行的「自检 → 报告 → 可修则修」形状补上。

## Alternatives considered

**只报告不修。** 最安全。否掉：缺索引与残留暂存都是常见的手滑或崩溃后果，重建空索引、删除已应用暂存无歧义；全交给作者等于让作者做工具该做的事。

**什么都修：用目录名当标题、`hooks.json` 写空、无 journal 的暂存直接删。** 一键。否掉：标题是作者的决定；空伏笔池比缺失更糟；没有 journal 就判断不了 rename 到哪一步，删了可能丢未应用的写入。

**不写 journal，只做「残留目录存在」告警。** 少改提交原语。否掉：那样只能永远告警、永远等人工；既然崩溃后要判断阶段，最小代价就是在提交里多写一个几十字节的 JSON。

**用 jobs 定时扫描。** 不需要作者触发。否掉：工作区变化没有事件可订阅，定时扫描只是空转；作者在接手前跑一次足够。

**把自检塞进 `story_next`。** 少一个工具。否掉：`story_next` 每轮都可能被调用，扫描要列目录、读 JSON，不该成为路牌成本。

## Consequences

收益：工作区被手滑或崩溃弄坏之后，作者不必翻目录猜——`story_recover` 会把「少了什么、能不能补、补完要不要重新确认」一次说清；能安全重建的索引直接补回，属主已死的提交残留按日志回滚或清理，不必人工拆暂存目录。

这条能力只读会话与文件、只写三种索引与暂存残留，不引入新的服务或存储。发现分类以 `FINDING_CODES` 为唯一来源，工具 schema 的枚举直接取自它；状态文件的默认内容以 `defaultStateFiles` 为唯一来源，foundation 与自检共用，两边不会漂移。提交日志只记阶段、属主与清单，不做锁；回滚只认「属主已死 + `prepared` + 还没搬空」，已应用的写入不会被撤销。日志里的路径一律收回作品根内，越界路径既不写也不删。

验证见 `test/recovery.test.mjs` 与 `test/host.test.mjs`（工具清单含 `story_recover`）。

代价与已知限制：

- 章节级对账没有交付，要等 P2／P3；这条能力只到工作区与提交两级。
- 属主判定用 pid：pid 被系统复用到一个无关进程时会误判为「活着」，结果只是留着不给修，不会误删。
- `pid` 只有本机意义：跨机器共享的工作区上，日志里的 pid 判定不可靠，工具会把残留当「属主活着」保留。
- 索引默认值里 `language` 固定 `zh`（沿用 foundation 的播种值）；`work.json` 记了 `en` 的作品重建后两者不一致——这是既有播种的行为，不是本行引入，等要修时两处一起改。
- `needsReconfirm` 依据的是会话里能读到的那次认可：如果当前会话没读过旧回执（换过会话），它会是 `false`，作者要自己按摘要判断。
- `.tmp-*` 的属主判定与暂存同理：pid 被复用会误判为「活着」而保留临时文件，不会误删；旧格式的临时文件永远只报告，靠人工清理。
- 「`work/` 已搬空」是间接证据：有写入时能判出 rename 做完没有；只有删除项的提交没有 staged 文件可看，一律按回滚处理。混合提交（写入 + 删除）在有写入时会按「搬空即完成」判，删除做到哪一步无法从日志判断——删除项当前没有生产调用方，等有调用方时再补更精确的阶段标记。
