# Handoff：v1 审计之后的全量工作流（含后续工作项）

日期：2026-11-15（Asia/Shanghai）
分支：`main`，HEAD `a323a9f`（AU-18 已提交并推送，CI 双端绿）。
工作区：**51 项未提交**；四个已实现工作项 + 一份已通过 Plan Review 的新工作项 + 相关文档/回执。

这份交接是当前唯一有效的交接，覆盖 2026-11-14 审计修复之后的所有工作项与剩余债，不只看当前面板节点。审计基线、v1 定义、AU-22/AU-23/AU-24/AU-19 等原始清单见历史文件 [`2026-11-14-v1-audit-repair-handoff.md`](./2026-11-14-v1-audit-repair-handoff.md)（仅作历史，不再更新）。

## 先读

- [`AGENTS.md`](../../AGENTS.md)、[`docs/AGENTS.md`](../../docs/AGENTS.md)、[`docs/scope.md`](../../docs/scope.md)、[`docs/fidelity-audit.md`](../../docs/fidelity-audit.md)、[`docs/dsh-mapping.md`](../../docs/dsh-mapping.md)。
- 当前五个工作项的 Note（都在 `.agents/notes/proposed/`，四个已实现、一个已规划未实现）：
  - `chapter.write` 正文交接：`bug-fix/2026-11-15-writer-subagent-draft-handoff.md`
  - `panel.workbench` 已结算投影：`bug-fix/2026-11-15-panel-settled-projection.md`
  - `foundation.approval` 作品级确认：`feature/2026-11-15-mandatory-foundation-signoff.md`
  - `chapter.settle` 首版结算确认：`feature/2026-11-15-explicit-settlement-gate.md`
  - `panel.workbench` 草稿/基础设定变更：`bug-fix/2026-11-15-panel-draft-and-foundation-change.md`（Plan Review 三轴 PASS，未实现）

## 当前状态

- AU-18 已关闭并提交：`a323a9f`；`runtime.stage-context` 在 fidelity 判「机制等价」，scope 已删 AU-18；D62（技能正文语言）与 D63（reviser 模式说明）作为后续债保留。
- 四个后续工作项实现完成、Implementation Review 两轴 PASS、未提交：
  1. **chapter.write 正文不进入主会话**：write 协议四行摘要、writer 子会话落盘后停止注入审稿阶段；`stages/index.ts` + `stage-context.test.mjs`。
  2. **panel.workbench 已结算投影**：`chapterSettled`、v7、章节 artifact 归 settle；`panel-index.ts`、`panel-types.ts`、四份测试。
  3. **foundation.approval 作品级确认**：`foundation-approval.ts`、`/story-approve` 写记录、`/story-write` 每次开章校验、面板已确认/已结算后失效态、AU-14 子项 1 关闭；`commands/gate/write-command/panel-index/stages` + 测试。
  4. **chapter.settle 首版结算显式确认**：`settle-approval.ts`、`settle-command.ts`、`panel-index/StoryView`、`settle-tool` marker 校验/消费、删除/重开清理；测试。
- 一项已规划未实现：
  5. **panel.workbench 结算前草稿 + 基础设定变更提示**：草稿只读、`chapterSettled` 与确认解耦、已结算保留「开始下一章」、确认只在顶部一次、v8、`panel.confirm` 文案与回执同步。Plan Review 三轴 PASS；下一条 `/implement`。
- 基线：`pnpm run verify` 569 tests／568 pass／1 skip；`check-capabilities` 45 verified／14 missing；`verify-notes` 101；本轮只改 Note，未重跑全量（代码未变）。

## batch 实测暴露的事实（新工作项的来源）

真实会话 `session-409ea38c-8d47-4c0b-aea9-1e07cad238d2`，工作区 `D:\workspace\see-dsh-novel-runtime`：

- `current_state=2`，第 1/2 章已发布，第 2 章已结算；`.drafts` 为空。
- 14:00 `/story-approve` 写 `foundation-approval.json`；14:07「补卷章」修改 `volume_map.md`，摘要失效。
- 磁盘 `panel.index.json` 仍是 v7（14:12 生成）：foundation current、五连排、confirmation 每阶段重复；第 2 章被显示成未结算。
- 作者在结算前无法读第 2 章正文：chapter.write 已把正文移出主会话，面板只有 `source/chapters`；源 Studio 的阅读面是聊天 `draft:delta`。

新工作项的决定：结算事实与基础设定确认解耦；基础设定失效只拦下一章（顶部提示，不换根动作、不置灰）；草稿在结算删除前以只读产物出现在面板；确认提示只在顶部一次；索引升 v8。

## 下一步：先收口当前批次

1. **实现第 5 项**：

   ```
   /implement 批准，执行实现 panel.workbench 结算前草稿与基础设定变更提示
   ```

2. **Implementation Review**（`code-review` 两轴）+ 修正。
3. **一次真实会话取证**（不要每项单独实测）：`pnpm --filter see-dsh-novel build` 并重启 DSH（宿主插件启动时加载），新开 `see-dsh-novel` 会话，cwd `D:\workspace\see-dsh-novel-runtime`：
   - `/story-write` 应先被拒（确认失效）；`/story-approve` 后开第 3 章；
   - 草稿落盘后在面板读草稿，结算后消失；
   - 面板 v8：第 2 章仍完成、顶部提示一次、开始下一章可点；
   - `/story-settle` 走首版结算。
4. **逐项 Verify** 五个工作项；真实会话未覆盖的条件保持 BLOCKED，不要提前关。
5. **六处同步 + 五个 PR**：五个能力行各自一个 PR；共享文件（`stages/index.ts`、`panel-index.ts`、`capabilities.yaml`、docs、real-runs）用 hunk 级暂存。CI 双端通过后再合并。

## 后续工作项（按建议优先级）

以下是 2026-11-14 审计清单中尚未关闭、以及本轮新增的后续项；细节以 `scope.md` / `fidelity-audit.md` 对应行为准。

1. **AU-14 子项 3**：`panel.confirm` 的「自由文本无执行权 + actionSource 拒绝」验收仍开；foundation.approval 子项 1 已闭，子项 3 需补测试/证据。
2. **AU-22 剩余**：阶段入口仍不重规划（`detectStage` 有 plan 即进 write/review）；索引进度仍 `current_state+1`；需要 replan 入口或统一 `resolveDurableStoryProgress`。这是下一步最大的旧债。
3. **D62**：随包技能正文是中文，源为英文；英文作品拿到中文方法正文。需要技能内容中英双份或按语言提供。
4. **D63**：reviser 模式说明（polish/rewrite/rework/anti-detect/spot-fix）未注入；`REVISE_MODE_GUIDE` 是死导出。
5. **AU-23 的 `safeChapterTitle` / D61 `chapter.import`**：`chapter.import` 不存在，D61 不能关；`safeChapterTitle` 等 import 能力落地。
6. **AU-24 现场重编排 + unavailable 父代理兜底**：review 重审/上下文已部分，现场重编排仍开。
7. **AU-19 trace id strict**：memory 检索的 schema 与源 strict 不一致、trace document id 命名不同。
8. **D24/P6 `materials.import`/`search.unified`**：book reference context 依赖这两个能力；`chapterCount N>1` 未实现。
9. **AU-31 / D39**：面板未复刻源工作台的设置编辑、删书、重修基础设定、章节重写/同步/版本恢复、本章 brief；真值文件仍只读（D39）。
10. **D38/D54/D57 等**：backup restore 导出回滚、skill reference 边界、EPUB 包结构；按 scope 逐项。
11. **结算修订/重算是否也要显式确认**：当前只覆盖首版 `story_settle_chapter`；若作者要求修订提交/重算也走确认，另立工作项。
12. **真实回执**：AU-20/AU-22/AU-24/AU-11 等仍有 P 级 limitation；不要冒充 S。

## 环境与陷阱

- profile `see-dsh-novel` 是 junction 到 `D:\workspace\see-dsh-novel\packages\see-dsh-novel`；`lib` 上次构建 21:31，DSH 21:55 重启。**改 `src` 后要重建 + 重启 DSH**，只新开会话不够。
- `pnpm` 不在 PATH，用 `%TEMP%\dsh-pnpm-bin\pnpm.cmd` shim。
- 真实工作区 `D:\workspace\see-dsh-novel-runtime` 的 v7 索引是旧的；新代码 v8 在会话创建/写动作后重建。
- 不要把 `.scratch/` 提交；不要用 process-level 回执冒充真实 DSH 会话；不要建第二套状态/判定表；不要一个 PR 混多个能力行。

## Suggested skills

- `implement`：第 5 项与后续工作项实现。
- `code-review`：Implementation Review 两轴。
- `verify`：batch 后逐项验收。
- `write-agent-notes`：proposed → implemented、旧 Note 同批更新。
- `planning`：AU-22 剩余、D62/D63、AU-14 子项 3 等新合同需要重新规划时。
- `dsh-doc`：需要 DSH 插件/tool/command/slot 事实时。
- `handoff`：再次交接。
