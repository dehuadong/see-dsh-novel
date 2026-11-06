# Agent Note: runtime.commit-safety —— 路径包含、串行化与失败留痕

Status: proposed

## Problem

复刻的整批提交（`core/commit.ts`）已经有「staging → 备份 → rename → 失败回滚」和崩溃日志，但缺三件与源工程一致的保护：

- **路径包含**：`commitFoundation` 用 `resolve(base, relativePath)` 直接拼路径，绝对路径或 `../x` 会写出作品根；同一批里重复写、写删同一路径、父路径与子路径同时出现，会在 rename 阶段留下半套提交（源实现 `utils/atomic-file-set.ts:118-165` 逐条拒绝）；
- **串行化**：两批提交同时进行时 staging 会交错；源工程按作品根排队（`atomic-file-set.ts:28-35`），并在每次提交前先回收死进程留下的暂存目录（`:142-145`）；
- **失败留痕**：本实现的 `finally` 无条件删除 staging；回滚本身失败时日志与备份一起消失。源实现在回滚失败时保留事务目录（`atomic-file-set.ts:196-210`）。

## Proposal

### 路径包含与冲突

`safeRelativePath(relativePath)` 与源实现逐条对齐：

- 去空白后不能为空；
- 不能是绝对路径；
- `normalize` 之后不能是 `..` 或以 `../` 开头；
- 返回规范化后的相对路径（`normalize` 已统一分隔符，不再额外拒绝反斜杠）。

`commitFoundation` 在动盘之前校验整批：

- 写入与删除都过 `safeRelativePath`；
- 写入路径不能重复；
- 同一路径不能既写又删；
- 不能同时触达目录和它的子路径（源报 `ATOMIC_PATH_OVERLAP`）。

### 串行化与死暂存回收

- `withCommitQueue(root, task)`：同一作品根上的提交依次执行；前一批失败不阻塞后一批。`commitFoundation` 走这个队列；
- 每次提交前扫描 `source/.staging-*`：属主进程已死时，`applied` 阶段直接删除、`prepared` 阶段按备份与 `existed` 恢复后删除；属主还活着就跳过。这段逻辑与 `runtime.recovery` 共用同一个 `parseJournal`（从 recovery 移到 commit，删除/report 仍归 recovery）；
- 跨进程的 book lock 不在本行：源工程用锁文件（`state/manager.ts:129-185`），复刻的并发都在同一宿主进程里。这条差额登记为新债行 `runtime.work-lock`（`source: state/manager.ts`），不写成合法偏差。

### 日志与留痕

- 日志在备份**之前**写入，并记录 `existed`（哪些目标在提交前已存在）；回滚按「有备份 → 用备份；没有备份且 `existed` 为假 → 删除；`existed` 为真但没有备份 → 保持不动」判断，避免删掉尚未备份的原文件；
- 回滚成功才删除 staging；回滚抛错时保留 staging（含日志与备份），把原始错误抛给调用方；
- 成功路径的 `applied` 标记与清理不变；日志字段新增 `existed`，旧日志没有该字段时按「未知」处理（恢复时不删除文件，只报出来）。

## Alternatives considered

**只在工具层校验路径。** 改动少。否掉：备份、回滚、删除都按同一批路径工作；校验放工具层会让每加一个工具漏一次。

**保持「备份后写日志」，不引入 `existed`。** 少改格式。否掉：源实现是日志先行；而本实现回滚判据依赖「没有备份就删除」，日志先行会删掉未备份的原文件。引入 `existed` 后两者可以同时成立。

**用文件锁做跨进程串行化。** 更彻底。否掉：这是另一条能力（`runtime.work-lock`）；本行只做同一进程内的提交队列与死暂存回收，差额记债。

**回滚失败时静默清理。** 日志更好看。否掉：调用方必须知道提交失败；源实现也保留目录并抛错。

## Acceptance criteria

- 绝对路径、`../x`、空路径在任何磁盘操作前被拒绝；作品根外不产生文件或目录。
- 重复写路径、写删同一路径、目录与子路径冲突时拒绝，不留下 staging、目标文件不改动。
- 同一根上两批提交串行执行（用带延时的任务断言顺序），前一批失败不阻塞后一批。
- 提交前会回收属主已死的 staging：`applied` 删除、`prepared` 按 `existed` 恢复；活着的属主目录不动。
- 日志在备份前写入且含 `existed`；回滚成功清理 staging；回滚失败保留 staging 并抛出原始错误；旧日志缺 `existed` 时恢复不删除文件。
- `test/commit-safety.test.mjs` 覆盖以上；`test/recovery.test.mjs` 与 `test/foundation.test.mjs` 相关断言同批调整（恢复逻辑改用共享的 `parseJournal`，行为不变）。
- 账本 `runtime.commit-safety` 的 `source` 改为 `utils/atomic-file-set.ts`、`dsh` 改为 `library + atomic write`；新增 `runtime.work-lock`（missing）；`docs/dsh-mapping.md` 登记 staging 路径／日志字段／阶段名这些内部格式差异（源行为不可观测，只影响恢复报告）。
- 实现与证据：implementation `packages/see-dsh-novel/src/core/commit.ts`；consumer `packages/see-dsh-novel/test/commit-safety.test.mjs`；realRun `artifacts/real-runs/runtime.commit-safety.json`。
- 真实运行：真实工作区上（1）一次含越界路径的提交被拒绝且无文件写出；（2）两批并发提交都完整落盘；（3）一次正常提交核对回执与文件。

## Risks

- 串行队列只在进程内生效；跨进程由 `runtime.work-lock` 承担。
- `existed` 是新字段：旧 staging 日志没有它，恢复时采取保守策略（不删文件），可能需要人工判断。
- 失败保留 staging 会占盘，直到下一次提交或自检清理。
- 目录/子路径冲突检查是 O(n²)，路径数在几十条量级，不构成性能问题。
