# Agent Note: runtime.commands —— 建书后启动基础设定、语言层与重新立项

Status: implemented

## Problem

审计 `runtime.commands` 还挂三笔债：

- **D19**：源 `book create` 在一条命令里同步跑完 `createBookFoundationTool`（身份 + 基础设定）；复刻 `/story-init` 只写身份，基础设定要再让模型按 `story_next` 走一步。
- **D20**：源 `resolveCliLanguage(opts.lang ?? config.language)` 先认显式 `--lang`，再认项目 `inkos.json` 的 `language`，再读 `INKOS_LOCALE`、`LC_ALL`／`LC_MESSAGES`／`LANG`，最后 `zh`；复刻只认显式值，缺省恒 `zh`。
- **D21**：源 `book create` 先用 `isCompleteBookDirectory` 判完整作品，不完整就 `rm` 整个 workDir 重建；复刻任何已存在的 `work.json` 都拒绝。

## 源工程证据

- `inkos/packages/cli/src/commands/book.ts:43-100`：`book create` 写 `BookConfig` 后调 `createBookFoundationTool`，由 `pipeline.initBook` 生成基础设定；`workDir` 已存在时 `StateManager.isCompleteBookDirectory(bookDir)` 为 false 就 `rm(workDir,{recursive:true,force:true})`，完整才抛「already exists」。
- `inkos/packages/core/src/state/manager.ts:528-547`：完整判据是 `book.json`、`story/outline/story_frame.md`、`story/outline/volume_map.md`、`story/book_rules.md`、`story/current_state.md`、`story/pending_hooks.md`、`chapters/index.json` 全部存在。
- `inkos/packages/cli/src/localization.ts:23-54`：`normalizeCliLanguageTag` 只认 `en*`／`zh*`；`resolveCliLanguage` 先显式，再 `INKOS_LOCALE`，再 `LC_ALL ?? LC_MESSAGES ?? LANG`，最后 `zh`。
- `inkos/packages/cli/src/commands/book.ts:72`：调用方传 `opts.lang ?? config.language`；`config.language` 来自 `inkos.json`（`ProjectConfigSchema.language` 默认 `zh`）。`INKOS_DEFAULT_LANGUAGE` 只是 `config init` 写进 `.env` 的提示，不在 `resolveCliLanguage` 的读取顺序里。
- DSH `CommandInvocation.agent` 是完整 `Agent`，`agent.followup`／`steer` 可排队下一轮（`plan-mode` 用 `agent.steer`）；命令可以启动后续阶段，但命令处理器不能同步等待一次模型生成。

## Decision

### D19：命令后启动基础设定

- `/story-init` 在 `initWork` 成功后，通过 `invocation.agent.followup` 投一条**宿主指令**：
  - `content`：`已完成立项。请按 story_next 的指示完成基础设定（outline → details / cast_index），不要开始写正文。`
  - `source`：`{ kind: 'story-command', command: 'story-init' }`；DSH v4 拒绝已退役的 `plugin` source，使用本插件拥有的来源 kind；消息进入会话日志，模型在下一轮看到。
- 命令回执分两段：身份行仍由 `describeWork` 生成；第二行改成「基础设定已启动；完成后按 story_next 继续」。命令不再说「下一步让主编…」。
- 命令处理器只在 `initWork` 成功后 followup；`initWork` 抛错不投消息。followup 抛错时返回 `kind:'error'`，文本带已写入的身份与「基础设定未启动，重试 /story-init 或按 story_next 继续」；不吞掉已存在的身份。
- 幂等：一次 `/story-init` 只投一条 followup；已有完整作品被拒绝时不再投。没有「后台任务 id」——followup 进入当前会话的下一轮，模型按阶段协议继续；失败由会话错误可见。
- `AgentLike` 增加可选 `followup(message)` 与最小 `UserMessageLike`（content text + source），仍不依赖 DSH 类型包；测试 fake agent 记录消息。
- 这是 DSH 机制差异：源命令**等待**基础设定完成并打印完成行；复刻命令**启动**下一轮，完成回执在后续回合。登记 `docs/dsh-mapping.md`，D19 从保真债改为机制等价。

### D20：语言解析顺序

- 新增 `resolveCommandLanguage(root, rawLang, env)`（纯函数 + 读 `inkos.json`）：
  1. `--lang` **出现过**时：`normalize(rawLang)`；`zh*`→`zh`、`en*`→`en`；不匹配就进入第 3 步，**不回退** `inkos.json`（源 `resolveCliLanguage('fr')` 就是跳过 config）。
  2. `--lang` 未出现：若工作区根有 `inkos.json`，读 `language`；缺失按源 `ProjectConfigSchema` 的默认 `zh`；存在但不是 `zh`／`en` 则报错（源 `loadConfig` 会解析失败，不静默走 env）；没有 `inkos.json` 才进入第 3 步。
  3. `INKOS_LOCALE` → `LC_ALL` → `LC_MESSAGES` → `LANG`，各按同一前缀归一，首个可用生效。
  4. 都不可用 → `zh`。
- `parseWorkCreate` 记录 `languageProvided`（`--lang=` 也算出现过），但不在解析层决定 config／env；解析结果保留归一后的 `language?` 或 `undefined`。
- `inkos.json` 是**项目语言**来源，不是身份文件；不写它，不要求完整 `ProjectConfig`，只读 `language` 字段；存在且字段非法时报错，不静默回退。
- `--lang=` 空串：源调用方传 `''`，`resolveCliLanguage` 显式归一失败 → env 层；复刻同。`--lang fr` 同。
- `describeWork` 的 `language` 仍由 `prepareWork` 校验 `zh`／`en`；命令层解析结果已是二选一。

### D21：重新立项的安全清理

- 新增 `isCompleteWork(root)`：用现有 `workProbes` 的六项（`hasWork`、`hasFrame`、`hasVolumeMap`、`hasRulesMd`、`hasRulesJson`、`hasPendingHooks`）判完整；源 `isCompleteBookDirectory` 还有 `chapters/index.json`，复刻没有该索引，登记为结构差异。
- 新增 `prepareCommandRoot(root)` 与 `clearIncompleteWork(root)`，**只由 `/story-init` 调用**：
  - 无 `work.json` → 正常新建。
  - 有 `work.json` 且完整 → 抛「已经存在完整作品，不覆盖」。
  - 有 `work.json` 但不完整 → 删除**内容根 `source/` 与工作区根的 `work.json`**，再新建；不删除工作区根本身、不碰 `.git`、不碰 `source/` 之外的作者文件。
- `prepareWork`／`assertWorkAbsent` 保持严格：`story_work_create`、提案批准等其它调用方继续拒绝已有 `work.json`；D21 的自动清理由命令入口独有，不扩散到工具。
- 源删整个 `workDir`；DSH 的工作区根就是作品根，不能 `rm` 根，所以清理集是 `source/` + `work.json`。这是 DSH 机制差异，登记 `docs/dsh-mapping.md`；D21 从保真债改为机制等价。
- 清理在 `initWork` 的写入之前；失败不写新身份。删除和新建之间没有事务回滚（源也没有）；测试断言失败时旧内容已删、不留下半新身份。
- `source/` 为空或只有 `work.json` 时的边界；`work.json` 坏到读不出时按不完整处理（源只看文件存在，不看解析），清理后重建。

### 文档、账本与测试

- 更新 `docs/fidelity-audit.md` 的 `runtime.commands` 行：D19／D20／D21 标为已偿还，判定改为「机制等价」；`docs/scope.md` 删除 D19／D20／D21。
- `docs/dsh-mapping.md` 增加两行：建书后 followup 启动基础设定、重新立项删除 `source/` + `work.json`（源删 workDir）。
- 账本 `runtime.commands` 的 realRun 重录；旧回执不能继续描述新行为。
- 测试：
  - `test/work-command.test.mjs`：followup 只投一次、消息文本/source、init 失败不投、followup 失败回执；
  - 语言矩阵：显式归一、显式未知跳过 config、无显式读 `inkos.json`、`INKOS_LOCALE`、`LC_ALL`/`LC_MESSAGES`/`LANG` 顺序、全缺省 `zh`、空串；
  - D21：完整作品拒绝、不完整作品删除 `source` + `work.json` 后重建、`source` 外文件保留、失败不写半新身份。
- 真机：空工作区 `/story-init` → 命令回执 + 下一轮基础设定；再在只写完身份的工作区 `/story-init` 验证清理重建；`inkos.json` 语言与 `--lang fr` 的回退。

## Alternatives considered

- **命令里同步跑基础设定** — 最强理由：与源命令输出完全一致。否掉：命令处理器不能同步等一次模型生成；DSH 的机制是 followup／steer，源行为等价点是“一条命令启动基础设定”，不是“命令阻塞到完成”。
- **不投 followup，继续让人点面板** — 零风险。否掉：D19 原样保留；源命令就是一次建完。
- **用 `agent.steer` 而不是 followup** — 最强理由：能插入当前回合。否掉：`/story-init` 的 handlers 在命令边界执行，没有正在生成的步骤需要 steer；followup 是“下一轮”，语义更准。
- **`--lang fr` 回退 `inkos.json`** — 最强理由：配置有语言就先用。否掉：源 `resolveCliLanguage(opts.lang ?? config.language)` 一旦显式值存在就进入 `resolveCliLanguage`，未知显式值走 env，不会回头读 config。
- **重新立项加 `--force`** — 最强理由：删除是破坏性的，让作者确认。否掉：源没有 force，且源对不完整作品是自动清理；DSH 用安全清理集（`source/` + `work.json`）已经限定了破坏范围。
- **删除整个工作区根** — 最强理由：最贴源 `rm(workDir)`。否掉：DSH 工作区根可能包含 `.git` 与作者文件；不能删根。

## Testing

- `/story-init` 成功后 followup 恰一次，消息是基础设定指令；命令回执说明「已启动」，基础设定在后续回合完成；init 失败不 followup；followup 失败有错误回执且不丢已写身份。
- 语言顺序与源一致：显式前缀 → 显式未知走 env（不读 config）→ 无显式读 `inkos.json` → `INKOS_LOCALE` → `LC_ALL`/`LC_MESSAGES`/`LANG` → `zh`；`--lang=` 空串同未知显式。
- 重新立项：完整作品拒绝；不完整作品删除 `source/` 与 `work.json` 后重建；`source/` 外文件保留；工作区根不被删除；失败不留半新身份。
- 审计/范围/账本/Note/dsh-mapping/realRun 同步；`pnpm run verify` 与 CI 双端通过。
- `pnpm run verify` 309 例通过；`test/work-command.test.mjs` 覆盖 followup 一次/失败、语言矩阵、完整/不完整重新立项。
- 真机：空工作区 `/story-init` 成功后 followup 启动基础设定；语言与清理回执重录在 `artifacts/real-runs/runtime.commands.json`。

## Consequences

- followup 是模型可见消息，必须可重建：source `plugin` + 文本；会话日志能解释下一轮来源。
- 命令回执不再承诺基础设定已完成；作者可能把「已启动」误当「已完成」；文本必须明确。
- 删除 `source/` 会丢掉未完成作品里已有的章节/角色；源就是整目录删除；这是破坏性行为，测试要覆盖边界，不在工作区根外动手。
- 缺 `chapters/index.json` 让复刻的完整判据比源少一项；登记结构差异，不能宣称逐项相同。
- `inkos.json` 只读 `language`，不复制完整 ProjectConfig；字段非法时报错，字段缺失按源默认 `zh`；没有 `inkos.json` 才走 env。
