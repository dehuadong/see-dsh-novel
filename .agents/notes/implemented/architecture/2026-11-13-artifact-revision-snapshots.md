# Agent Note: 章节 revision 的不可变快照

Status: implemented

## Problem

复刻的章节 artifact 每个 revision 的 `path` 都指向同一个章节文件：`r1` 写入时 checksum 对应旧正文，修订覆盖章节后 `r2` 成为 current，`r1` 仍登记旧 checksum 但已没有可读的旧字节。原 `readArtifactRevision`（`core/artifact-store.ts`）直接读 `revision.path`，没有 `snapshotPath` 回退，因此旧 revision 悬空；`chapter-review.ts` 是它的唯一消费者（校验 current revision 与被审正文一致）。

源工程给每个 revision 写不可变快照：

- `harness/source-sync.ts:111-118` 为 revision 生成 `snapshotPath = revisions/<artifactId>/<revisionId><ext>`，并在 `:132` 写入 `works/<workId>/<snapshotPath>`；旧 current 被覆盖前也会补写 `previousSnapshot`（`:157-163`）。
- `harness/artifact-reader.ts:25-37` 读 revision 时优先 `snapshotPath`，缺失返回 `ARTIFACT_SNAPSHOT_UNAVAILABLE`（`:32-33`），校验和不符返回 `ARTIFACT_REVISION_CONFLICT`（`:35-36`）。
- `harness/contracts.ts:45` 的 revision 允许可选 `snapshotPath`。

追溯评审记为 D42。本行补章节 revision 的快照写入、回填、恢复同步与读取；generic artifact 的 `snapshotPath` 与 revision id 形状（源用 `rev-<checksum前16位>`）不在本行。

## 源工程证据

- `inkos/packages/core/src/harness/source-sync.ts:105-118,132`：`revisionSnapshotPath` 的路径形状与首次写入。
- `inkos/packages/core/src/harness/source-sync.ts:157-163`：覆盖旧 current 前补写 `snapshotPath`，并校验旧正文 checksum。
- `inkos/packages/core/src/harness/artifact-reader.ts:25-37`：按 `snapshotPath ?? path` 读取、`realpath` 限制在作品内、checksum 不符报冲突、缺失报快照不可用、越界报 `ARTIFACT_PATH_OUTSIDE_WORK`。
- `inkos/packages/core/src/harness/contracts.ts:45`：`snapshotPath` 是 revision 的可选相对路径。

## Decision

### 范围与非目标

- 范围：章节 artifact 的每个 revision 写 `snapshotPath` 与快照文件；修订覆盖旧 current 前补写旧快照（旧工作区也回填）；恢复旧版追加 revision 并同步快照；扩展 `readArtifactRevision` 按 `snapshotPath ?? path` 读取并校验 checksum。
- 非目标：不把 revision id 改成源形状；不给 generic `stageArtifactRevision` 补快照（其 `path` 本身即不可变 revision 文件）；不改章节 `.versions` 归档；不改 manifest 的 `path` 语义。
- review 仍用 reader 消费 current revision（读取来源改为快照）。

### 交付行为

- 首次写章：`r1` 的 `snapshotPath` 为 `source/artifacts/<artifactId>/revisions/<revisionId>.md`，快照为该 revision 正文；章节与 manifest 同批写。
- 修订：`r2` 快照同批写；`r1` 的 `snapshotPath` 保留且内容不变，即使章节文件已被覆盖。
- 恢复旧版：追加一个 revision（快照为恢复后的正文），旧 current 快照在回填中保留；恢复后复审/修订不被旧 checksum 阻塞。
- 读取：`readArtifactRevision` 按 `snapshotPath ?? path` 读取并 `realpath` 限界，校验 sha256 与 `byteLength`；缺失、冲突、越界、未知分别带 `ARTIFACT_SNAPSHOT_UNAVAILABLE`、`ARTIFACT_REVISION_CONFLICT`、`ARTIFACT_PATH_OUTSIDE_WORK`、`ARTIFACT_NOT_FOUND`。
- 旧 manifest 的 current 无 `snapshotPath` 时，修订用 `previousContent` 的 sha256 对齐旧 checksum：相符才回填；不符拒绝且不写盘。
- 章节删除后旧 revision 快照仍可读。

### 决定与未决问题

- 快照目录用现有 generic revision 约定 `source/artifacts/<artifactId>/revisions/<revisionId>.md`，不新建第二套布局；与源的布局差异登记 `dsh-mapping.md`。
- 快照与 manifest 同一 `commitFoundation`，避免 manifest 指向尚不存在的文件。
- 恢复旧版必须同步 artifact：否则恢复只改章节文件，旧 manifest 的 checksum 校验会永久阻塞复审与修订。
- 未决问题：无。

### 评审与批准证据

- Plan Review 第 1 轮：需修订（`readArtifactRevision` 已存在且 review 是消费者；旧 current 未回填快照；快照布局未登记偏差；读取错误码与行号不全）；已修正。
- Plan Review 第 2 轮：仍需修订（`assertManifest` 未校验 `path`；历史 revision 回填表述矛盾；Problem 段行号未改）；已修正。
- Plan Review 第 3 轮：仍需修订（回填前未校验 `previousContent` 与旧 checksum）；已补。
- Plan Review 第 4 轮：通过，无未解决 blocker/major。
- Implementation Review（Standards / Spec）：首轮各报 4／5 条；恢复同步、readArtifact `realpath` 越界、快照错误码测试、回填不写盘断言、路径校验测试与注释修正后复核通过。
- 批准与执行授权：2026-11-13，作者批准 `implement artifact.identity`。

## Design

### 写入

`src/core/artifact-store.ts`：

- `baseArtifact` 已支持可选 `snapshotPath`；`chapterArtifactWrite` 为每个 revision 生成：
  - `snapshotPath = source/artifacts/<artifactId>/revisions/<revisionId>.md`
  - 返回新增 `snapshot: { relativePath, content }`，以及 `backfill?: { relativePath, content }`。
- `chapterArtifactWrite` 接受可选 `previousContent`：旧 current 无 `snapshotPath` 时先比对 sha256 与 `checksum`，不符抛 `ARTIFACT_REVISION_CONFLICT` 且不写任何文件；相符才生成旧 revision 快照并回填 `snapshotPath`。
- `writeChapterDocument`、`reviseChapterDocument` 与 `restoreChapter` 把 `snapshot`／`backfill` 加入同批 `commitFoundation`。
- `assertManifest` 对 `path` 与存在的 `snapshotPath` 都做相对路径校验。

### 读取

`src/core/artifact-store.ts` 的 `readArtifactRevision`：

- 读 `snapshotPath ?? path`，先 `realpath` 再校验仍在作品根内；缺失/冲突/越界/未知分别带 `code`。
- 返回 `{ revision, bytes }`，签名与现有调用方不变；`chapter-review.ts` 继续用它校验 current revision。

### 偏差登记

`docs/dsh-mapping.md` 补：源快照在作品内 `revisions/<artifactId>/<rid><ext>`（工作根 `works/<workId>/` 下），复刻在 `source/artifacts/<artifactId>/revisions/<rid>.md`（工作区根）；原因：复刻的作品根就是工作区、artifacts 集中在 `source/artifacts`；验证：reader 按 `snapshotPath` 解析并校验 checksum。

### 兼容与失败行为

- 旧 manifest 的 revision 没有 `snapshotPath` 时，读取回退到 `path`；修订覆盖旧 current 时用 `previousContent` 回填旧快照。
- 首次写章不需要回填；`writeChapterDocument` 只写新 revision 的快照。
- 快照写入失败时整批回滚，manifest 不会指向缺失文件。
- 删除章节不会删除 artifact 快照目录；`readArtifactRevision` 仍可读。
- `ARTIFACT_PATH_OUTSIDE_WORK` 由 reader 的 `realpath` 校验触发（符号链接越出作品根）；manifest 装载同时拒绝越界的相对路径。

## Alternatives considered

- **把快照放在 `.versions`** — 复用现有归档。否掉：`.versions` 是章节版本（按章号），revision 快照要按 artifactId/revisionId 读；混用会让两种身份互相依赖。
- **让 `path` 直接指向不可变 revision 文件** — 少一个字段。否掉：源保留 `path` 指向源文件、`snapshotPath` 指向快照；review 经 reader 读快照，面板仍按章节路径展示。
- **只写快照、不做读取入口** — 债务只补一半。否掉：D42 的「不可读」正是缺读取方；没有读取入口，快照无法被消费与验证。
- **同时改 revision id 为 checksum 形状** — 更贴源。否掉：现有 `r1`／`r2` 被审稿、面板与测试消费，另立工作项。
- **恢复旧版不同步 artifact** — 少一处改动。否掉：恢复后旧 manifest 的 checksum 校验会永久阻塞复审与修订。

## Testing

- `test/artifact-store.test.mjs`（6 例）：stage/promote/current；章节 r1/r2 快照、旧 revision 可读、旧 manifest 回填、回填 checksum 冲突不写盘、ID/路径与越界拒绝。
- `test/chapter-document.test.mjs`（5 例）：写章生成快照且内容与章节一致。
- `test/chapter-revise.test.mjs`（19 例）：r1/r2 `snapshotPath`、章节删除后读取、`ARTIFACT_SNAPSHOT_UNAVAILABLE`／`ARTIFACT_REVISION_CONFLICT`／`ARTIFACT_NOT_FOUND`。
- `test/chapter-reopen.test.mjs`（7 例）：恢复追加 revision，r1/r2 都可读且 r1 为旧正文。
- `test/chapter-review.test.mjs`：reviewedArtifact 仍走 current revision。
- `pnpm run verify` 全绿：437 tests（Windows 跳过 symlink 用例）；`artifacts/real-runs/artifact.identity.json` 已重录。
- D42 已从 `docs/scope.md` 注销；mapping 补快照布局偏差，审计判定同步。

## Consequences

- 每个 revision 多一个快照文件；章节正文较大时提交略大。
- 旧工作区的非 current 历史 revision 不回填快照（仍可能悬空）；current 在下次修订覆盖前回填。
- 删除章节不清理快照，作品目录会留下历史 revision 文件；这是不可变快照的预期。
- 恢复旧版会多一个 revision，artifact 历史变长但可追溯。



