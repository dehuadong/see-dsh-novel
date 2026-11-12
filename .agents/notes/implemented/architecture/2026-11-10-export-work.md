# Agent Note: export.work —— 导出作品（txt／md／epub）

Status: implemented

## Problem

P6 的 `export.work` 曾是 `missing`。章节、状态与产物都在工作区里，但作者拿不到一份可交付的整本文件；面板只读展示，不是导出。源工程提供 txt／md／epub 三种格式，按章节索引与章节文件一一对应地拼出整本，并在索引与文件不一致时拒绝导出。

## 源工程证据

- `inkos/packages/core/src/interaction/export-artifact.ts:27-38`：`ChapterExportSourceError` 的 `CHAPTER_EXPORT_SOURCE_MISMATCH`，details 含缺失章、重复章、重复索引、未入索引文件；`:40-69` 的 `buildChapterFileLookup` 逐项核对。
- 同文件 `:98` 默认 `txt`；`:100-160` 的 `buildExportArtifact`——章节来自 `loadChapterIndex`；正文用 `renderChapterDocument(chapter.number, chapter.title ?? heading, raw, language)` 重新渲染；`txt` 以书名开头、章节之间空行；`md` 以 `# 书名` 开头；`epub` 的章标题取渲染后的 `#` 标题（`:115-128`，含「第N章」），语言交给 `epub-gen-memory`（`:131`）；输出路径默认 `exports/<bookId>.<format>`，`fileName` 为 `<bookId>.<format>`；返回 `chaptersExported`／`totalWords`／`contentType`。
- 同文件 `:162-182`：`writeExportArtifact` 直接 `writeFile`（`:174-176`），返回 outputPath／chapters／words／format。
- `inkos/packages/studio/src/api/server.ts:5606-5675`：GET 按 format 返回附件；POST `/export-save` 写到 `bookDir/<id>.<fmt>`，经 `createExportBookTool` 以 `recoverable-write` 执行；`ChapterExportSourceError` 映射 409。

## Decision

### 核心：`buildWorkExport`／`writeWorkExport`

`src/core/export.ts`：

- 输入：`format: 'txt'|'md'|'epub'`；输出到工作区根 `<workId>.<format>`（与源 export-save 落点一致；`workId` 来自 `work.json`）。
- 章节来源：`chapters/index.json` 是权威顺序；与 `source/chapters/*.md` 逐章核对，四种不一致都抛 `ChapterExportSourceError`（code `CHAPTER_EXPORT_SOURCE_MISMATCH`，details 同源）。
- 正文：`renderChapterDocument(chapter, title, 文件原文, work.language)` 重新渲染；`txt` 以书名开头、章节间空行；`md` 以 `# 书名` 开头。
- 空章节列表拒绝（源的 “No chapters to export.”）。
- 原子替换：同目录临时文件 + `rename`；失败清理临时文件。源是直接 `writeFile`；作者裁决导出改为贴源直写，当前实现仍为原子替换，记 D50。`totalWords` 取索引 `wordCount` 之和（源语义）。
- 返回 `{ outputPath, fileName, chaptersExported, totalWords, format, byteLength }`。

### EPUB

`src/core/zip.ts` 的最小 ZIP（store）写入器 + `src/core/export.ts` 的 EPUB3 结构：

- ZIP 第一项 `mimetype`（不压缩），`META-INF/container.xml`、`OEBPS/content.opf`、`OEBPS/nav.xhtml`、`OEBPS/chapter-<n>.xhtml`；
- 每章标题当前取索引 title（缺失时取文件名主体），正文按行分段为 `<p>` 并转义；源用渲染后的 `#` 标题。章 XHTML 的 `xml:lang` 当前固定 `zh-CN`，nav 标题固定「目录」；源按 `work.language` 交给打包器、标题随渲染结果。以上记 D50。
- 不引入 `epub-gen-memory` 或任何打包库。

### 落点：命令与面板

- 命令：`src/plugin/export-command.ts` 注册 `/story-export [txt|md|epub]`；默认 `txt`；非法格式返回错误；`withWorkAction` 内构建与写；回执带路径、章节数、字数、字节数。宿主执行，不经过模型。
- 面板：`Workbench` 页头新增格式选择（TXT／Markdown／EPUB）与「导出」按钮；`StoryView` 直接 `runCommand(sessionId, '/story-export <fmt>')`，复用命令通道，不经过 agent、不占阶段动作条、任意阶段可用（`busy`／`running` 时禁用）。

### 范围与非目标

- 只导出当前作品；不导出翻译、番外、剧本、短篇。
- 不做下载响应头与 Studio 的 POST/GET 端点；DSH 侧落文件即可。
- 不从章节文件自动补索引（源要求索引一致；缺索引就是 mismatch）。
- 不引入第三方打包库。

### 偏差与债务

- 无新的机制偏差：导出是 DSH 命令 + 文件写入，面板控件走 `runCommand`。
- D50：EPUB 标题/语言/导航未贴源，原子替换是源没有的写入方式；作者裁决全部贴源（取渲染标题、按 `work.language`、直接写）。
- 导出文件不进产物摘要：源导出也在 `story/` 之外，等价。

## Alternatives considered

- **只做 txt／md，EPUB 记债** — 省一个打包器。否掉：三种格式是同一行的可见能力，EPUB 可自实现，不应缺产物。
- **加 `epub-gen-memory` 依赖** — 与源完全同构。否掉：本地无该包、需要联网安装；为一个格式引入第三方依赖不划算。
- **只做命令，不做面板控件** — 更小的 diff。否掉：面板是体验面，源 Studio 有导出按钮；面板已经能 `runCommand`，不必绕 agent。
- **直接流式下载，不落文件** — 更接近 GET 端点。否掉：DSH 会话没有 HTTP 下载面；作者要的是工作区里的一份文件。
- **导出到 `source/exports/`** — 集中。否掉：源 export-save 落在作品根；`source/` 是 canon，导出物不应进产物摘要。
- **从章节文件自动重建索引** — 容错。否掉：源明确拒绝 mismatch，自动重建会掩盖索引损坏。

## Testing

- `test/export.test.mjs`：txt／md 书名与章节、四种索引不一致与 details、空作品拒绝、原子替换（旧内容不残留）、EPUB ZIP 首项 `mimetype` 与条目集合、命令格式解析（md／默认 txt／非法格式）。EPUB 章标题与 `xml:lang` 没有按 `work.language` 的断言（D50）。
- `test/host.test.mjs`：命令清单包含 `story-export`。
- `tsc -p tsconfig.client.json`：面板导出控件的类型闭合；React 渲染无 DOM 测试，覆盖限制在构建与类型检查。
- `pnpm run verify` 全绿；回执记录三种格式各一次导出。

## Consequences

- EPUB 只做 EPUB3 必需项；阅读器兼容性需要真机验证，超出本行的进程级测试。
- 索引字数落后于当前正文时，导出文件是当前正文、统计沿用索引（与源一致，刷新索引归定稿）。
- 导出与结算/定稿通过 `withWorkAction` 互斥；导出不锁读者。
- 面板导出控件的交互（选择格式、点击、回执）没有自动化 UI 测试，只能靠类型检查与真机操作。
