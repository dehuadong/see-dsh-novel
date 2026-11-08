# Agent Note: runtime.txn-format —— 根目录事务、entries 日志与 committed 阶段

Status: implemented

## Problem

`runtime.txn-format` 是账本里一直 `missing` 的行：事务目录、日志字段、备份方式与阶段名都还是复刻自己的格式，不是源的。审计把这件事压缩成 `runtime.commit-safety` 的 D9（「前缀 `.staging-` ≠ `.inkos-file-txn-`」），但前缀只是表层；既有 Note 也明确把整套格式登记在 `runtime.txn-format`，不是 commit-safety。

现状差异：

- 事务目录：复刻 `source/.staging-*`；源在作品根 `.inkos-file-txn-*`，用 `mkdtemp` 创建；
- 布局：复刻 `work/`＋`backup/`；源 `staged/`＋`backup/`；
- 日志：复刻 `writes[]`／`deletes[]`／`existed[]`，阶段 `prepared`｜`applied`；源 `entries:[{path,existed}]`，阶段 `prepared`｜`committed`；
- 备份：复刻复制目标到 backup、再 `rm` 目标；源把目标 **rename** 到 backup，删除项由这次 rename 完成；
- 恢复：复刻扫 `source/`，并对「`prepared` 但 `work/` 已空」做清理启发式；源扫作品根，死属主的 `prepared` 一律回滚、`committed` 清理。

复刻的两处恢复选择（`applied` 标记写失败不回滚、`staged` 空则清理）是比源更保守的设计，不是 DSH 强制，也不是不可观测。用户已裁决：本行连恢复语义一起按源对齐，旧选择由本篇显式取代。

## 源工程证据

- `inkos/packages/core/src/utils/atomic-file-set.ts`：
  - `PREFIX = ".inkos-file-txn-"`（L18）；
  - `JournalSchema`：`{version:1, pid, phase:"prepared"|"committed", entries:[{path, existed}]}`，`.strict()`（L19-L24）；
  - `serialize(root, …)` 按根排队（L28-L35）；
  - `writeJournal`：`journal.next` → fsync → rename 成 `journal.json`（L37-L43）；
  - `rollback`：有 backup 就 `copyFile`／`cp` 回来；没有 backup 且 `existed=false` 就删；`existed=true` 没有 backup 就不动（L51-L66）；
  - `recoverRoot`：扫作品根里以 `PREFIX` 开头的目录，无日志跳过，日志坏了抛错，活属主跳过，`prepared` 回滚，删除目录（L68-L93）；
  - `commitFileSet`：`mkdtemp(join(rootDir, PREFIX))`（L168），`staged/`＋`backup/`（L169-L170），`entries` 先算 `existed`（L172-L175），先写 `prepared` 日志（L186），再把触及的原目标 `rename` 到 backup（L189-L197），把 staged 写入 rename 到位（L199-L202），最后写 `committed`（L203）；失败回滚，回滚失败保留目录并把 pid 改成 0（L204-L216）。
- 账本 `runtime.commit-safety` 只拥有路径包含、串行化与失败留痕；`runtime.txn-format` 才是本行（`capabilities.yaml` 的 `runtime.txn-format`，当前 `missing`）。

## Decision

### 事务目录与布局

- 事务目录建在作品根：`mkdtemp(join(base, '.inkos-file-txn-'))`；
- 布局 `staged/`（写入内容）与 `backup/`（被移走的目标）；
- 不再创建 `source/.staging-*`，也不保留旧前缀别名。

### 日志

- `CommitJournal` 改为 `{version:1, pid, phase:'prepared'|'committed', entries:[{path, existed}]}`；`entries` 按「写入路径 + 删除路径」的顺序，`existed` 在 staging 之前算好。
- `writeJournal` 与源一致：`journal.next`、0o600、fsync、rename 成 `journal.json`，内容用紧凑 JSON。
- `parseJournal` 只接受源形状；未知字段、旧 `writes/deletes/existed` 形状、坏阶段都算读不出来。

### 提交与备份

- 保留 commit-safety 的路径包含、重复/写删/目录重叠校验与按根队列；
- 写入先落到 `staged/`，写 `prepared` 日志；
- 对所有触及的、已存在的目标执行 `rename(target, backup/path)`：写入的旧内容被移走，删除项也在这一步生效；
- 把 `staged/` 里的写入 `rename` 到目标；新目标没有 backup，回滚时按 `existed=false` 删除；
- 写 `committed`；成功清理事务目录；
- `committed` 写失败进入回滚（源的语义）；回滚失败保留事务目录、把日志 pid 改成 0 并抛错。

### 恢复

- `recoverDeadTransactions(base)` 扫作品根里 `.inkos-file-txn-*`：无日志保留；日志坏了抛错；活属主跳过；`prepared` 回滚后删目录；`committed` 直接删目录。
- 回滚只依赖 `entries` 与 backup 是否存在、`existed` 是否为真；不再维护 `applied` 数组。
- `recovery.ts` 的 `story_recover` 改扫作品根；发现项的路径改为 `.inkos-file-txn-*`（相对作品根），详情改称「事务目录」；`staging-active`／`staging-rollback`／`staging-cleanup`／`staging-unknown` 这四个 code 保留，它们是工具 schema 的稳定标识，不在本行改名。
- 删掉「`prepared` 但 `staged/` 为空就清理」的启发式：死属主的 `prepared` 一律按回滚报告与执行，和源一致。`runtime.recovery` 的旧决定由本篇显式取代。
- `story_recover` 的扫描/修复与提交共用同一个按根队列，避免和进行中的提交交错。

### 兼容与边界

- 旧 `source/.staging-*` 目录与旧 `writes/deletes/existed` 日志不再扫描、不再迁移；这是预发布格式，项目非目标本来就不做旧作品迁移。
- `CommitResult` 返回值、字符串内容、`commitFile` 的单文件临时文件保持现状；二进制 `Uint8Array` 内容不在本行（当前没有二进制工件）。
- `runtime.commit-safety` 的路径/队列/失败留痕不因本行改变；它只从复刻格式切换到源格式。`runtime.recovery` 的索引重建、临时文件清理不变。

### 文档、证据与测试

- 新增 `test/txn-format.test.mjs`：根目录与前缀、`staged/backup`、`entries` 日志与紧凑格式、rename 备份（原目标被移走）、`committed`、回滚、死 `prepared` 回滚、`committed` 清理、活属主跳过、坏日志/无日志、旧 `.staging-*` 不被扫描。
- 更新 `test/commit-safety.test.mjs` 与 `test/recovery.test.mjs` 的夹具、路径与阶段；`test/foundation.test.mjs` 的中途失败回滚保持通过。
- 更新既有 Note：`runtime-commit-safety` 的格式差额改为「已由 txn-format 承接」，并同步失败留痕的源语义；`runtime-recovery` 的扫描路径、日志字段、阶段与启发式改为源语义；两篇链接本篇。
- 账本：`runtime.txn-format` 的 implementation／consumer／realRun 指向 `core/commit.ts`、`test/txn-format.test.mjs`、`artifacts/real-runs/runtime.txn-format.json`；`runtime.commit-safety` 与 `runtime.recovery` 的 realRun 回执因磁盘行为变化同批重录。
- 审计：新增 `runtime.txn-format` 段；`runtime.commit-safety` 行删除 D9、判定「等价」并注明格式归 txn-format；`docs/scope.md` 删除 D9。
- 真实运行：`runtime.txn-format` 用根目录死事务夹具跑 `story_recover`，观察 `staging-rollback .inkos-file-txn-*`，再用一次 `story_truth_file` 提交确认成功后根目录无残留；`runtime.commit-safety` 与 `runtime.recovery` 的回执按新路径/阶段重录。
- `pnpm run verify` 通过，CI 双端绿。

## Alternatives considered

- **只改前缀** — 最强理由：改动最小，D9 字面上只是一行字符串。否掉：目录仍在 `source/`，日志、备份、阶段、恢复扫描都还是复刻格式；会留下「名字像源、语义不是源」的混合事务，恢复不可靠。
- **保留复刻的 `applied`／staged-empty 安全策略** — 最强理由：`committed` 标记写失败时不会回滚已应用文件，崩溃恢复更保守。否掉：用户裁决按源对齐；保留就是登记新债，而且 `entries` 日志没有 `writes/deletes` 区分，staged-empty 判据要另造推断，反而更复杂。
- **保留复制备份** — 最强理由：目标在提交过程中一直存在，读方不会看到短暂缺失。否掉：源用 rename 备份，删除项也依赖这次移动；复制备份加 `rm` 是另一套事务语义。
- **保留旧 `.staging-*`／旧日志兼容** — 最强理由：开发期崩溃残留还能被自检看到。否掉：预发布格式，非目标不做迁移；两套格式会让「扫哪个目录、按哪个 schema 恢复」变成长期分支。
- **只改 `runtime.commit-safety` 的 D9** — 最强理由：审计就是这么写的。否掉：格式是 `runtime.txn-format` 的整行能力，commit-safety 的安全行为已对齐；在 commit-safety 下改前缀会让两个能力互相污染。

## Consequences

事务格式现在与源一致：作品根 `.inkos-file-txn-*`、`staged/`＋`backup/`、`entries`、rename 备份、`committed` 阶段；死 `prepared` 一律回滚，死 `committed` 只清理；旧 `.staging-*` 与旧日志不迁移。`runtime.commit-safety` 的路径、队列与失败留痕不变；`runtime.recovery` 改扫作品根并去掉 staged-empty 启发式。

验证：`test/txn-format.test.mjs` 5 例（运行中根事务、layout、entries、紧凑日志、rename 备份、死 prepared 回滚、死 committed 清理、旧格式不扫描）＋ 更新后的 `test/commit-safety.test.mjs`、`test/recovery.test.mjs`；`pnpm run verify` 291 例通过，CI 双端通过。真机回执在 `artifacts/real-runs/runtime.txn-format.json`：会话 `session-be199bcf-db91-4deb-ae75-6da15a44a06f` 的 `story_recover` 在作品根发现 `staging-rollback .inkos-file-txn-fixture`，修复后 `story_frame.md` 回到「旧大纲」、根事务消失；随后 `story_truth_file` 写 `author_intent.md` 成功且无根事务残留。`runtime.commit-safety` 与 `runtime.recovery` 的回执同批重录。

代价与残余风险：

- `committed` 标记写失败会回滚已应用文件（源语义）；磁盘写满/权限异常时可能丢掉一次本已成功的提交。
- rename 备份跨设备可能失败；测试都在同一卷上，跨设备按源失败处理。
- 根目录会出现短暂的 `.inkos-file-txn-*`；成功即删，失败保留给自检。
- 旧 `.staging-*` 残留不再被自检看到，需要人工清理；预发布格式不做迁移。
- 回滚失败路径以 `AggregateError` 保留日志；没有在真机里制造磁盘故障来触发它。
