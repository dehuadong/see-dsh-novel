# Agent Note: runtime.work-lock —— 跨进程作品锁

Status: implemented

## Problem

`runtime.work-lock` 在账本里是 `missing`；`runtime.commit-safety` 只有同进程按根排队，两个进程同时写同一作品时没有跨进程互斥。源工程 `StateManager.acquireBookLock` 用 `source/.write.lock` 保护一次作品写操作：同进程并发拒绝、跨进程锁文件、心跳、死锁接管；复刻目前没有这一层，P1 出口缺 D27。

## 源工程证据

- `inkos/packages/core/src/state/manager.ts:129-213`：`acquireBookLock(bookId)`；若 `ownsWorkMutation(projectRoot, bookId)`（当前动作已持有该作品的 mutation scope）直接返回 no-op；否则在 `bookDir/.write.lock` 建锁，进程内 `processBookLocks` 先占位，`open(lockPath,'wx')`；EEXIST 时读快照，非 stale 抛 `BookWriteLockError`（`BOOK_BUSY`），stale 则按 raw 内容比对后删除重试，最多 4 次。
- `manager.ts:18-28`：`BOOK_LOCK_HEARTBEAT_MS=30_000`、`BOOK_LOCK_LEASE_MS=3*60_000`、`BOOK_LOCK_RELEASE_RETRIES=4`；metadata 为 `{version:1,pid,token,startedAt,heartbeatAt}`。
- `manager.ts:270-282`：stale 判据：同 pid 的孤儿文件、pid 不存活、或 lease metadata（version 1 + token）且 `heartbeatAt ?? mtimeMs` 超过 3 分钟；没有 lease metadata 的旧格式不能用时间判断。
- `manager.ts:296-323`：心跳每 30s 更新 `heartbeatAt`，token 不匹配不写；timer `unref`。
- `manager.ts:325-338`：释放时按 token 比对，`unlink` 对 EPERM/EACCES/EBUSY 重试 4 次。
- `manager.ts:340-351`：`isProcessAlive` 用 `process.kill(pid,0)`，ESRCH 视为死。
- `utils/work-mutation-scope.ts:1-23`：`withWorkMutationScope(root,workId,acquire,task)` 用 `AsyncLocalStorage<Set<string>>` 做 reentrancy；`runInWorkMutationQueue(key,task)` 用 `Map<root\0workId,Promise>` 做 whole-action 串行。源锁在 **tool/harness action boundary** 获取，不在 `commitAtomicFileSet` 里；`harness/runtime.ts:151-154`、`harness/tools/work-creation.ts:24`、`pipeline/runner.ts` 都是这个边界。
- 源 `commitAtomicFileSet` 是 lock-agnostic（`manager.ts:525,553`）；`runInWorkMutationQueue` 是 whole-action 串行，`withWorkMutationScope` 是 reentrancy + 锁获取；`withCommitQueue` 只对应提交事务排队。

## Decision

### 锁文件与 metadata

- 新增 `core/work-lock.ts`，锁路径 `source/.write.lock`（源 `bookDir` 是 `works/<id>/source`；DSH 内容根 `source` 对应）。
- metadata 与源一致：`{version:1,pid,token,startedAt,heartbeatAt}`；token 用 `randomUUID()`。
- 常量与源一致：heartbeat 30s、lease 3min、release retry 4、acquire retry 4。
- 文件创建 `open(path,'wx')`；EEXIST 读 raw + stat；stale 时比对 raw 再删，避免删别人的新锁。
- 释放只删 token 匹配的锁；`unlink` 重试同上；失败保留日志，不静默吞。

### 同进程 reentrancy 与 whole-action 队列

- 进程内 `Map<realpath, owner>` 保留；同进程并发同作品直接 `BOOK_BUSY`。
- `withWorkMutationScope(root, workId, acquire, task)`：`AsyncLocalStorage<Set<root\0workId>>`；同一 async context 嵌套直接执行，不同 context 仍拒绝。对应源 `ownsWorkMutation`。
- `runInWorkMutationQueue(key, task)`：`Map<root\0workId, Promise>`；whole action 串行；和 `withCommitQueue` 是两层，前者 action、后者 commit txn。
- 源顺序：`runInWorkMutationQueue(key, () => withWorkMutationScope(key, acquire, task))`；`acquire` 调 `acquireWorkLock`，`finally` release；嵌套不重复建锁。
- `release` 幂等；锁对象与 scope 分离，scope 负责 reentrancy，锁对象负责文件。

### stale 与接管

- stale 判据与源一致：同 pid 孤儿、pid 不存活、lease metadata（version 1 + token）且 `heartbeatAt ?? mtimeMs` 超过 3min。
- 同 pid 孤儿：进程内 Map 没有 owner、但文件 pid 是自己（上一条任务崩溃）时允许接管；有 owner 时先被 Map 拒绝。
- pid 不存活直接接管；pid 存活但 `heartbeatAt ?? mtimeMs` 过期才接管；没有 lease metadata 的旧格式不能用时间判断，保留 `BOOK_BUSY`，避免误删。
- 心跳只更新自己 token 的文件；文件被替换/删除时停止，不重建。

### 集成点

锁覆盖**作品写 action**，不在 commit 加锁：

- 新增 `core/work-mutation.ts` 的 `withWorkMutationScope`／`runInWorkMutationQueue`；`core/work-lock.ts` 只负责 lock 文件/metadata/acquire/release。
- 在 action 入口按源顺序包：`/story-init` 的 `initWork`、`story_work_create`、`story_propose`、`story_foundation_*`、`story_truth_file`、`story_hooks`、`story_plan_chapter`、`story_write_chapter`、`story_review_chapter`、`story_recover`、`story_foundation_signoff`。
- `commitFoundation`／`commitFile` 保持 lock-agnostic；`withCommitQueue` 只做事务串行，不替代 work-lock。
- 第二个进程在锁有效时得到 `BOOK_BUSY`，错误文本含作品与 lock 信息；不等待、不重试到超时，由调用方决定。

### 与 commit queue 的关系

- 不新增 commit 内锁层；`commitFoundation`／`commitFile` 与源 `commitAtomicFileSet` 一样不感知锁。
- `runInWorkMutationQueue`（action）与 `withCommitQueue`（commit txn）同时存在：前者保证同一作品的 action 不并行，后者保证同一根的提交批次不交错。
- 源锁在 `bookDir`，DSH 锁在 `source/`；路径映射登记 `docs/dsh-mapping.md`。

## Alternatives considered

- **只靠 `withCommitQueue`** — 零新代码。否掉：它只在同进程有效，两个 DSH 进程可同时写同一工作区；源有跨进程锁。
- **在 `commitFoundation` 只加文件锁，不包工具入口** — 覆盖所有写。否掉：源不在 commit 加锁；`story_write_chapter` 的“已有章节不覆盖”是读-检查-写，两个进程可能都通过检查再先后 commit。工具/harness action 锁才与源一致。
- **用 `proper-lockfile` 之类依赖** — 成熟。否掉：源已有明确 metadata/心跳/lease 语义，手写能逐字段复刻；新增依赖不会自动匹配 token/lease 行为。
- **用 SQLite 或 DSH storage 做锁** — 已有存储。否掉：锁是文件系统跨进程原语，源就是 lock 文件；SQLite 会引入第二套锁语义与清理问题。
- **不实现 stale 接管，只报 BOOK_BUSY** — 简单。否掉：源明确接管死 pid/过期 lease；不接管会让崩溃后永久锁死。

## Testing

- `acquireWorkLock` 成功建 `source/.write.lock`，metadata 字段/常量与源一致；release 删除自己的锁，token 不匹配不删。
- `withWorkMutationScope` + `runInWorkMutationQueue`：同 action 嵌套不重复建锁；同进程并发同作品第二个立即 `BOOK_BUSY`；不同 action 排队。
- 跨进程：第一个进程持锁时，第二个进程 `BOOK_BUSY`；第一个 release 后第二个可获取。
- stale：pid 不存活、同 pid 孤儿、lease metadata 且 `heartbeatAt ?? mtimeMs` 超过 3min 可接管；活 pid + 未过期 lease 拒绝；没有 lease metadata 的旧格式不误删。
- 心跳更新自己的 heartbeatAt；文件被换/删时不重建；timer unref；测试直接改 metadata 的 heartbeatAt/mtime 制造 stale，不等待 30s/3min。
- `commitFoundation`／`commitFile` 保持 lock-agnostic；只读工具不建锁；所有 action 入口按源顺序包 queue → scope。
- 测试：`test/work-lock.test.mjs`（in-process、nested、stale、token、release、heartbeat、跨进程 child、action queue）与 `test/commit-safety.test.mjs` 回归；真实回执记录 `artifacts/real-runs/runtime.work-lock.json`（两个进程/会话同工作区，一个成功一个 BOOK_BUSY）。
- 审计 `runtime.work-lock` 从 D27 保真债改为等价（或登记机制偏差）；`docs/scope.md` 删除 D27；`docs/fidelity-audit.md` 更新旧的“P2/P3/P6 已 verified”文字；`docs/dsh-mapping.md` 加锁路径/action queue 行；`capabilities.yaml` source 补 `utils/work-mutation-scope.ts`，implementation/consumer/realRun 指向新证据。
- 实施后：`core/work-lock.ts`、`core/work-mutation.ts`、`test/work-lock.test.mjs` 6 例；`pnpm test` 315 例全绿；`artifacts/real-runs/runtime.work-lock.json` 记录同进程/stale/token/队列/跨进程 child 回执。

## Consequences

- `withWorkMutationScope`/`runInWorkMutationQueue` 的 reentrancy 必须正确；漏掉一个 action 入口会让读-检查-写仍有竞态，重复加锁会死锁。
- 心跳 timer 在进程退出/异常时必须清理；`unref` 防止阻止退出，但锁文件要靠 stale 接管，不能靠 timer 存活。
- 跨进程测试在 Windows 上对文件删除/rename/占用更敏感；测试要覆盖 EPERM/EACCES/EBUSY 重试，不能只在 Linux 通过；stale 用重写 metadata/mtime 制造，不 sleep。
- 锁路径 `source/.write.lock` 与源的 `source/.write.lock` 一致；不要写到工作区根或 `source/story`，避免被当作产物/状态审计。
- 同 pid 孤儿判据依赖进程内 Map；如果进程重启后 pid 复用，可能误判；源也有同样风险，按源行为保留。
- `commitFoundation` 不加锁意味着任何新写入口都必须走 `withWorkMutationScope`；遗漏时没有编译错误，只能靠 action 清单/消费者测试兜住。
