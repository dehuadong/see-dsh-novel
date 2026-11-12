# Agent Note: backup.restore —— 整本备份与恢复

Status: implemented

## Problem

P6 的 `backup.restore` 曾是 `missing`。作品散在工作区里，作者没有“先备份再动大手术”的入口：重开、删章、批量修订之前无法留一个整本快照；恢复时也没有自动的“恢复前备份”，一次误操作就可能把当前版本覆盖掉。

源工程在 CLI 里提供整本备份：把整个作品目录复制到项目根的 `.inkos/backups/<bookId>/<stamp>/`，列出备份，恢复时先给当前作品做一次 `pre-restore` 备份，再用选中的备份覆盖作品目录。备份必须能在作品损坏时使用（例如 `book.json` 坏掉），所以备份模块不依赖作品身份文件。

## 源工程证据

- `inkos/packages/cli/src/book-backup.ts:34-37`：`bookBackupsDir(root, bookId)` = `<root>/.inkos/backups/<bookId>`；注释写明备份放在 works 之外，因此备份里不会包含其它备份。
- 同文件 `:39-84`：`createBookBackup(root, bookId, { now, suffix })`——只检查作品目录是目录（不读 `book.json`）；id 为 `YYYYMMDD-HHMMSS`（UTC），`suffix` 拼在时间戳后，重名追加 `-2`、`-3`；`cp(bookDir, backupPath, { recursive: true })`。
- 同文件 `:86-107`：`listBookBackups`——只列目录，`createdAt` 取目录 mtime 的 ISO，按 id 倒序；空目录返回空数组。
- 同文件 `:109-150`：`restoreBookBackup(root, bookId, backupId, { now })`——id 必须是单段安全目录名（`/^[A-Za-z0-9._-]+$/` 且不是 `.`／`..`）；备份不存在时报错；作品目录存在时先 `createBookBackup(..., { suffix: 'pre-restore' })`；然后 `rm(bookDir, { recursive: true, force: true })`、`cp(backupPath, bookDir, { recursive: true })`；返回 `preRestoreBackupId`。
- `inkos/packages/cli/src/commands/book.ts:301-374`：`book backup` 的 create/list/restore 接线；注释明确“Backups must also work on broken books (e.g. corrupted book.json)”。
- `inkos/packages/cli/src/__tests__/book-backup.test.ts`：整本复制、id 冲突 `-2`、list 倒序、pre-restore id、只拒绝不存在目录、id 安全校验。
- 素材：源素材本体在 `<projectRoot>/.inkos/materials`（`materials/ingest.ts:55`），不在作品目录内；作品内的素材 sidecar 是 `source/story/reference_bindings.json`（`__tests__/book-references.test.ts:55`）。

## Decision

### 备份位置与备份集合

DSH 一个工作区就是一部作品，没有源工程的“项目根 + `works/`”层级；命令能拿到的稳定根只有会话工作区（`docs/dsh-mapping.md` 的 `/story-init` 与 `--brief` 两条已登记）。因此备份放在工作区内：

- `<workspace>/.backups/<backupId>/`，不再加 `<workId>/` 一层——一工作区一作品，且备份必须能在 `work.json` 删掉/损坏时使用（源的 CLI 注释与测试都这样要求）；
- 备份集合与恢复集合对称，只含作品拥有项：`work.json` 与 `source/`。根上的 `.git`、作者文件、导出文件、`.backups/` 与死事务目录都不进备份；
- 复制 `source/` 时排除：`source/.write.lock`（活动锁）与 `source/story/runtime/panel.index.json`（面板投影，已登记为产物摘要/内容包/导出/备份的排除项）；
- 恢复时只替换这两项，**不删除工作区根**：`.git`、作者放在根上的文件、导出文件与 `.backups/` 都保留；`source/.write.lock` 保留（恢复在锁内执行，删掉会让本进程无法正常释放锁）。

### 核心：`src/core/backup.ts`

- `createBackup(root, { now?, suffix? })`：只要求工作区是目录（不读 `work.json`）；id = `formatStamp(now)`，有 `suffix` 时为 `<stamp>-<suffix>`，重名追加 `-2`…；复制 `work.json` 与 `source/`（排除活动锁与投影）到 `.backups/<backupId>/`；返回 `{ backupId, path }`。
- `listBackups(root)`：只列 `.backups/` 下的目录，`createdAt` = mtime ISO，按 id 倒序；目录缺失返回空数组。
- `restoreBackup(root, backupId, { now? })`：
  1. 校验 id 为单段安全目录名；备份目录必须存在；
  2. 内容判据（锁内、排除锁文件）：`work.json` 存在，或 `source/` 里除 `.write.lock` 外有任一条目 → 先 `createBackup(..., { suffix: 'pre-restore' })`；否则 `preRestoreBackupId: null`。pre-restore 抓到的是**回放死事务之前**的当前状态；
  3. 再 `recoverDeadTransactions(root)`：根上有崩溃遗留事务时先回放/清理；回收失败时在锁内把根下所有 `.inkos-file-txn-*` 改名为 `.dead-txn-*` 隔离（不再匹配回收前缀），记录 `isolatedTransactions` 后继续——恢复马上整体替换 `work.json`＋`source/`，这些 rollback 数据已无意义；隔离本身失败才拒绝；
  4. 删除 `work.json` 与 `source/`（保留 `source/.write.lock`），把备份里的同名项复制回来；`.backups/` 与工作区根其它条目不动；
  5. 返回 `{ restoredFrom, preRestoreBackupId, isolatedTransactions }`；复制失败原样抛错。

### 锁、投影与恢复后一致性

- `createBackup`、`restoreBackup` 都在 `withWorkAction` 内执行：备份与结算/定稿/写章互斥；恢复成功后投影尝试重建 `panel.index.json`。
- 恢复不触达活动锁；恢复后立即再执行一次写 action 必须成功（锁已正常释放）。
- 恢复后的 `work.json`／`source/` 与备份一致（排除 `source/.write.lock` 与 `panel.index.json`）；根上的导出文件保持恢复前的状态（D38）。
- 投影是尽力而为：`withWorkAction` 会吞掉投影异常。若从 `work.json` 损坏的备份恢复，投影失败，索引保持旧值或缺失，直到 `work.json` 被修复（写 action 与会话发布补建都要求身份可读）；回执不宣称已重建。

### 落点：`/story-backup` 命令

`src/plugin/backup-command.ts` 注册 `/story-backup [create|list|restore <id>]`：

- 无参数或 `create`：创建备份，回执 id 与路径；`list`：按 id 倒序列出 id 与 createdAt；`restore <id>`：恢复，回执 `restoredFrom`、`preRestoreBackupId` 与隔离数量；
- 解析规则：空白分隔；动作名只认小写 `create`／`list`／`restore`；`restore` 必须恰好一个 id；多余 token、未知动作、`restore` 缺 id 都返回错误；id 交给 core 的源正则校验（`\`、`/`、`..` 都拒绝）。
- 命令由宿主执行，不经过模型；源没有面板备份入口（Studio 只有章节版本 restore），面板不加动作。

### 范围与非目标

- 只备份/恢复当前工作区；不跨作品、不导入外部压缩包。
- 不做增量备份、保留策略、加密或上传；每次都是作品拥有项复制。
- 素材本体（源的 `.inkos/materials`）不在作品内，备份不包含；作品内的 `source/story/reference_bindings.json` 随 `source/` 一起备份与恢复。素材导入能力（D22／D24）落地后，sidecar 布局变化需要重新核对本行。
- 恢复不做 staging 或原子替换：与源一样是“删除 + 复制”，失败需要人工处理；`pre-restore` 备份是兜底。

### 偏差与债务

- 备份位置：源 `<projectRoot>/.inkos/backups/<bookId>` → DSH `<workspace>/.backups/<backupId>`；原因：DSH 没有项目根与 `works/` 层级，工作区是命令唯一稳定根。
- 恢复范围：源 `rm(bookDir)` 整目录替换 → DSH 只替换 `work.json` 与 `source/`，保留根上 `.git`／作者文件／导出／`.backups` 与活动锁；原因与 `/story-init` 的清理裁定一致（工作区根可能是仓库根）。
- 恢复前回放死事务：源没有这一步；复刻的提交事务目录在作品根，恢复是裸 fs 覆盖，不先回收会让下一次 commit 用旧事务备份覆盖恢复内容；回收失败时隔离为 `.dead-txn-*` 后继续。
- 上述三条写进 `docs/dsh-mapping.md` 的四段格式。
- **D38（新债）**：源恢复会连同 `exports/` 一起回滚；复刻的导出在根上且不在作品拥有项内，恢复后导出文件仍是恢复前的内容，形成“旧章节 + 新导出”。偿还：恢复时先用恢复前的 `work.json` id 删除根上三种导出（`<id>.txt|md|epub`），再用恢复后的 id 兜底删一次，由作者重新导出；身份不可读时保留并在回执提示。登记 `docs/scope.md`。

## Alternatives considered

- **备份放在工作区父目录的 `.dsh-work-backups/`** — 与源“备份在作品之外”最接近。否掉：DSH 没有项目根概念，父目录可能是仓库根或共享目录；命令的稳定根只有工作区。
- **放在 `~/.dsh/` 全局目录** — 跨作品集中。否掉：需要额外的作品标识、清理与跨机同步策略；备份是作品自己的运维数据。
- **保留 `<workId>/` 一层** — 多作品共用一个工作区时更整齐。否掉：DSH 一工作区一作品；`work.json` 损坏时必须能备份/恢复，读身份文件会让这条路径在最需要时失效。
- **恢复整目录替换（含根）** — 与源逐字一致。否掉：DSH 工作区根可能是 `.git` 仓库，删根会破坏仓库与作者文件；`/story-init` 已经为此立过裁定。
- **用 zip 单文件备份** — 传输方便。否掉：源是目录复制；zip 需要打包器，恢复要解包，增加失败面。
- **恢复用 staging + 原子替换** — 更稳。否掉：源就是直接删除再复制；自创原子恢复需要额外的回滚机制，超出本行。

## Testing

- `test/backup.test.mjs`：拥有项复制与排除（锁、panel.index、根文件、`.backups`、`work.json`）；id 冲突 `-2`、list 倒序、空列表；恢复替换 `work.json`/`source`、保留根文件与活动锁、pre-restore 备份；坏 `work.json` 仍可 create/restore；空工作区 `preRestoreBackupId: null`；不可读事务日志被隔离为 `.dead-txn-*` 且恢复成功；非法/缺失 id；命令 create/list/restore 与参数边界；命令恢复后锁已释放、可再次创建。
- `test/host.test.mjs`：命令清单包含 `story-backup`。
- `pnpm run verify` 全绿；`artifacts/real-runs/backup.restore.json` 记录。

## Consequences

- 恢复是“删除 + 复制”，中途失败会留下半恢复状态；`pre-restore` 备份用于人工兜底，与源一致。
- 恢复只替换作品拥有项，根上导出文件不会被回滚；这是 D38 的已知缺口，偿还前需要重新导出或手动对齐。
- `.backups/` 在工作区内，工作区被整体删除时备份一起丢失；源 `.inkos/backups` 在删除单个作品时保留。DSH 一工作区一作品，这是位置偏差的已知代价。
- 备份不做保留策略，长期使用会占空间；清理由作者手动进行。`.dead-txn-*` 隔离目录同样只在人工排查后清除，不参与备份与投影。
- 投影重建要求 `work.json` 可读；从坏身份文件恢复时索引留待修复后补建。
