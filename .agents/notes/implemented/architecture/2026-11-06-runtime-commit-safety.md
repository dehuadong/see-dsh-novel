# Agent Note: runtime.commit-safety —— 路径包含、串行化与失败留痕

Status: implemented

> 事务目录与日志格式已由 [runtime.txn-format](2026-11-08-runtime-txn-format.md) 接管；本篇只保留 commit-safety 的路径校验、按根队列与失败留痕。

## Problem

复刻的整批提交（`core/commit.ts`）已经有「staging → 备份 → rename → 失败回滚」和崩溃日志，但缺三件与源工程一致的保护：

- **路径包含**：`commitFoundation` 用 `resolve(base, relativePath)` 直接拼路径，绝对路径或 `../x` 会写出作品根；同一批里重复写、写删同一路径、父路径与子路径同时出现，会在 rename 阶段留下半套提交（源实现 `utils/atomic-file-set.ts:118-165` 逐条拒绝）；
- **串行化**：两批提交同时进行时 staging 会交错；源工程按作品根排队（`atomic-file-set.ts:28-35`），并在每次提交前先回收死进程留下的暂存目录（`:142-145`）；
- **失败留痕**：本实现的 `finally` 无条件删除 staging；回滚本身失败时日志与备份一起消失。源实现在回滚失败时保留事务目录（`atomic-file-set.ts:196-210`）。

事务目录、日志字段与备份方式已由 `runtime.txn-format` 接管；跨进程锁仍是未交付的 `runtime.work-lock`。

## Decision

### 路径包含与冲突

`safeRelativePath(relativePath)` 与源实现逐条对齐：

- 去空白后不能为空；
- 不能是绝对路径；
- `normalize` 之后不能是 `..` 或以 `../` 开头；
- 返回规范化后的相对路径（`normalize` 已统一分隔符，不再额外拒绝反斜杠）。

`commitFoundation` 在动本批的任何文件之前校验整批（死暂存的回收可能先发生，与源实现「先 recover 再校验」的顺序一致）：

- 写入与删除都过 `safeRelativePath`；
- 写入路径不能重复；
- 同一路径不能既写又删；
- 不能同时触达目录和它的子路径（源报 `ATOMIC_PATH_OVERLAP`）。

### 串行化与死事务回收

- `withCommitQueue(root, task)`：同一作品根上的提交依次执行；前一批失败不阻塞后一批。`commitFoundation` 走这个队列；
- 每次提交前扫描作品根的 `.inkos-file-txn-*`：属主进程已死时，`committed` 阶段直接删除、`prepared` 阶段按备份与 `entries[].existed` 回滚后删除；属主还活着就跳过。事务格式与回收判据见 [runtime.txn-format](2026-11-08-runtime-txn-format.md)；这段逻辑与 `runtime.recovery` 共用同一个 `parseJournal`（从 recovery 移到 commit，删除/report 仍归 recovery）；
- 跨进程的 book lock 不在本行：源工程用锁文件（`state/manager.ts:129-185`），复刻的并发都在同一宿主进程里。这条差额登记为新债行 `runtime.work-lock`（`source: state/manager.ts`），不写成合法偏差。

### 日志与留痕

- 日志在备份**之前**写入，并记录 `entries[].existed`（哪些目标在提交前已存在）；回滚按「有备份 → 用备份；没有备份且 `existed` 为假 → 删除；`existed` 为真但没有备份 → 保持不动」判断，避免删掉尚未备份的原文件；
- 回滚成功才删除事务目录；回滚抛错时保留事务目录（含日志与备份），把日志属主改成 0 以便下一次提交或自检接管，并把原始错误抛给调用方；
- 成功路径写 `committed` 再清理；`committed` 写失败会进入回滚（源语义），不再有「已应用但不回滚」的尽力而为分支。

## Alternatives considered

**只在工具层校验路径。** 改动少。否掉：备份、回滚、删除都按同一批路径工作；校验放工具层会让每加一个工具漏一次。

**保持「备份后写日志」，不引入 `existed`。** 少改格式。否掉：源实现是日志先行；而本实现回滚判据依赖「没有备份就删除」，日志先行会删掉未备份的原文件。引入 `existed` 后两者可以同时成立。

**用文件锁做跨进程串行化。** 更彻底。否掉：这是另一条能力（`runtime.work-lock`）；本行只做同一进程内的提交队列与死暂存回收，差额记债。

**回滚失败时静默清理。** 日志更好看。否掉：调用方必须知道提交失败；源实现也保留目录并抛错。

## Consequences

收益：整批提交现在在动盘前拒绝越界路径、重复写、写删冲突与目录/子路径重叠；同一作品根上的提交串行执行，提交前先回收属主已死的提交事务；日志在备份前写入并记录 `entries[].existed`，回滚据此判断「恢复、删除还是不动」，回滚失败时保留事务目录与备份而不是一起删掉。

落地：`packages/see-dsh-novel/src/core/commit.ts`（`safeRelativePath`、冲突检查、`withCommitQueue`、`recoverDeadTransactions`、`entries` 日志与失败留痕、`parseJournal`／`pidAlive`）、`src/core/recovery.ts`（复用同一份日志解析与 `existed` 判据）。

验证见 `test/commit-safety.test.mjs`（路径越界、重复/冲突/重叠、队列顺序与失败不阻塞、死 `prepared` 按备份与 `existed` 恢复、死 `committed` 清理、日志解析）与 `test/txn-format.test.mjs`（根目录事务、entries、旧格式不扫描）；同批 `test/foundation.test.mjs` 的中途失败回滚保持通过。

### 代价与已知限制

- 串行队列只在同一进程内生效；跨进程并发没有锁，差额已登记为债行 `runtime.work-lock`。
- 事务格式已由 `runtime.txn-format` 交付；本行只保留路径、队列与失败留痕的行为。
- 旧 `source/.staging-*` 目录与旧日志不迁移，自检不再扫描它们。
- 回滚失败时事务目录会保留占盘，直到下一次提交或自检清理。
